import { byId } from "./by-id";
import { create } from "./create";
import { deleteResume } from "./delete";
import { list } from "./list";
import { update } from "./update";

export const resumeRouter = {
  list,
  byId,
  create,
  update,
  // `delete` — зарезервированное слово, поэтому алиас от deleteResume
  delete: deleteResume,
};
