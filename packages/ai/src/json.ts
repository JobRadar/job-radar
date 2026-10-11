import { generateText, type LanguageModel } from "ai";
import { z } from "zod";

const MAX_ATTEMPTS = 3;

/**
 * Достаёт JSON-объект из ответа модели: снимает ```json-обёртку и отбрасывает
 * текст вокруг первой «{» и последней «}».
 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("в ответе нет JSON-объекта");
  }
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * Структурированный ответ LLM для шлюзов, которые игнорируют `response_format`
 * (оборачивают JSON в markdown или отвечают прозой), где `generateObject` падает.
 *
 * JSON-схема передаётся в промпте, ответ разбирается устойчиво и валидируется
 * через zod; при невалидном ответе запрос повторяется с описанием ошибки.
 *
 * @throws если за {@link MAX_ATTEMPTS} попытки не получен валидный объект
 */
export async function generateJson<S extends z.ZodType>(params: {
  model: LanguageModel;
  schema: S;
  system?: string;
  prompt: string;
}): Promise<z.output<S>> {
  const jsonSchema = JSON.stringify(z.toJSONSchema(params.schema));
  const system = [
    params.system,
    "Ответь СТРОГО одним JSON-объектом без markdown-обёртки и пояснений, соответствующим этой JSON Schema:",
    jsonSchema,
  ]
    .filter(Boolean)
    .join("\n\n");

  let prompt = params.prompt;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { text } = await generateText({
      model: params.model,
      system,
      prompt,
    });

    try {
      const parsed = params.schema.safeParse(extractJson(text));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.message;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    prompt = `${params.prompt}\n\nПредыдущий ответ не прошёл проверку (${lastError.slice(0, 400)}). Верни только корректный JSON-объект по схеме.`;
  }

  throw new Error(
    `Модель не вернула валидный JSON за ${MAX_ATTEMPTS} попыток: ${lastError.slice(0, 300)}`,
  );
}
