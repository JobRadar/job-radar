/**
 * Root Router
 *
 * The single entry-point for the entire oRPC API.
 * Add new domain routers here and they become available everywhere
 * (Next.js handler, RSC clients, type-safe hooks, etc.).
 *
 * Current route map:
 *
 *   user.*          – current user profile & account settings  (protected)
 *   post.list       – paginated list of posts                  (public)
 *   post.byId       – single post by UUID                      (public)
 *   post.create     – create a post                            (protected)
 *   post.delete     – delete a post                            (admin)
 *   vacancy.list    – paginated list of vacancies             (protected)
 *   resume.*        – current user's resumes CRUD              (protected)
 *   admin.users.*   – user management                          (admin)
 *   admin.stats.*   – system-wide statistics                   (admin)
 */

import { adminRouter } from "./admin";
import { postRouter } from "./post";
import { resumeRouter } from "./resume";
import { userRouter } from "./user";
import { vacancyRouter } from "./vacancy";

export const appRouter = {
  user: userRouter,
  post: postRouter,
  admin: adminRouter,
  vacancy: vacancyRouter,
  resume: resumeRouter,
};

export type AppRouter = typeof appRouter;
