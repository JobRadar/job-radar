import { byId } from "./by-id";
import { create } from "./create";
import { deleteResume } from "./delete";
import { generate } from "./generate";
import { list } from "./list";
import { update } from "./update";

export const resumeRouter = {
  list,
  byId,
  create,
  update,
  generate,
  // `delete` — зарезервированное слово, поэтому алиас от deleteResume
  delete: deleteResume,
};
