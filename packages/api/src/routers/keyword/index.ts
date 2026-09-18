import { create } from "./create";
import { deleteKeyword } from "./delete";
import { list } from "./list";
import { update } from "./update";

export const keywordRouter = {
  list,
  create,
  update,
  // `delete` — зарезервированное слово, поэтому алиас от deleteKeyword
  delete: deleteKeyword,
};
