/**
 * Нормализует результат `db.execute(sql)` к массиву строк.
 *
 * Драйверы возвращают разное: node-postgres — объект `{ rows }`,
 * neon-http — массив строк. Этот хелпер скрывает различие.
 */
export function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === "object" && "rows" in res) {
    return ((res as { rows: unknown }).rows as T[]) ?? [];
  }
  return [];
}
