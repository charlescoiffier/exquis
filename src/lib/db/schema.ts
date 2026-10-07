import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export const gameType = pgEnum("game_type", ["drawing", "text"]);
export const gameStatus = pgEnum("game_status", ["open", "in_progress", "completed", "cancelled"]);
export const gameVisibility = pgEnum("game_visibility", ["public", "invite"]);
export const turnStatus = pgEnum("turn_status", ["pending", "active", "done", "expired", "open_call"]);
export const drawDirection = pgEnum("draw_direction", ["down", "right"]);

export const profile = pgTable("profile", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("player"),
  emailEnabled: boolean("email_enabled").notNull().default(true),
});

export const game = pgTable("game", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: text("creator_id").notNull().references(() => user.id),
  name: text("name").notNull(),
  type: gameType("type").notNull(),
  turns: integer("turns").notNull(),
  turnDurationSeconds: integer("turn_duration_seconds").notNull(),
  visibility: gameVisibility("visibility").notNull(),
  inviteToken: text("invite_token").notNull(),
  status: gameStatus("status").notNull().default("open"),
  direction: drawDirection("direction"),
  language: text("language"),
  minWords: integer("min_words"),
  maxWords: integer("max_words"),
  excerptMode: text("excerpt_mode"),
  excerptWords: integer("excerpt_words"),
  // Intitulés facultatifs des tours (tête, corps, jambes…), un par tour ; chaîne vide = pas d'intitulé.
  turnLabels: jsonb("turn_labels").$type<string[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export const participant = pgTable(
  "participant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id").notNull().references(() => game.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id),
    rank: integer("rank"),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
    /** Renseigné quand le joueur quitte une partie en cours : ses contributions restent, ses tours sont libérés. */
    leftAt: timestamp("left_at"),
  },
  (t) => [unique("participant_game_user").on(t.gameId, t.userId), index("participant_user_idx").on(t.userId)],
);

export const turn = pgTable(
  "turn",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id").notNull().references(() => game.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    // null uniquement pendant un appel à participation (statut open_call)
    assignedUserId: text("assigned_user_id").references(() => user.id),
    status: turnStatus("status").notNull().default("pending"),
    deadline: timestamp("deadline"),
    startedAt: timestamp("started_at"),
    attempts: integer("attempts").notNull().default(0),
  },
  (t) => [unique("turn_game_rank").on(t.gameId, t.rank), index("turn_active_idx").on(t.status, t.deadline)],
);

export const contribution = pgTable("contribution", {
  id: uuid("id").primaryKey().defaultRandom(),
  turnId: uuid("turn_id").notNull().unique().references(() => turn.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id),
  text: text("text"),
  imageKey: text("image_key"),
  stripKey: text("strip_key"),
  hiddenAt: timestamp("hidden_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const draft = pgTable("draft", {
  turnId: uuid("turn_id").primaryKey().references(() => turn.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id),
  content: jsonb("content").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    gameId: uuid("game_id").notNull().references(() => game.id, { onDelete: "cascade" }),
    turnId: uuid("turn_id"),
    dedupeKey: text("dedupe_key").notNull().unique(),
    readAt: timestamp("read_at"),
    emailPending: boolean("email_pending").notNull().default(false),
    emailedAt: timestamp("emailed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("notification_user_idx").on(t.userId, t.createdAt)],
);

export const invitation = pgTable("invitation", {
  code: text("code").primaryKey(),
  createdBy: text("created_by").references(() => user.id),
  claimedAt: timestamp("claimed_at"),
  usedBy: text("used_by").references(() => user.id),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const report = pgTable("report", {
  id: uuid("id").primaryKey().defaultRandom(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  reporterId: text("reporter_id").notNull().references(() => user.id),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const finalWork = pgTable("final_work", {
  gameId: uuid("game_id").primaryKey().references(() => game.id, { onDelete: "cascade" }),
  imageKey: text("image_key"),
  width: integer("width"),
  height: integer("height"),
  joints: jsonb("joints").$type<{ start: number; end: number }[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
