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
  // Rappel avant la fin d'un tour : part du temps restant (50, 25 ou 10 %) ; 0 = aucun rappel.
  reminderStage: integer("reminder_stage").notNull().default(25),
  // Avatar géométrique : forme imposée, couleur de la forme et du fond (palette fixe) ; null = avatar par défaut dérivé du compte.
  avatarShape: text("avatar_shape"),
  avatarColor: text("avatar_color"),
  avatarBg: text("avatar_bg"),
  // Code à communiquer pour être ajouté en ami (créé à la demande).
  friendCode: text("friend_code").unique(),
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
  // Thème facultatif de la partie, visible de tous les joueurs.
  theme: text("theme"),
  // Jeton du lien public en lecture seule (parties terminées) ; null = pas de lien. Activé et révoqué par le créateur.
  publicToken: text("public_token").unique(),
  // Œuvre masquée par la modération : plus visible de personne, lien public retiré.
  hiddenAt: timestamp("hidden_at"),
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

export const comment = pgTable(
  "comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id").notNull().references(() => game.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    hiddenAt: timestamp("hidden_at"),
  },
  (t) => [index("comment_game_idx").on(t.gameId, t.createdAt)],
);

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
    // Absent pour les notifications qui ne concernent pas une partie (demandes d'ami).
    gameId: uuid("game_id").references(() => game.id, { onDelete: "cascade" }),
    // Personne à l'origine de la notification (demande d'ami, invitation).
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
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

/** Signalement d'un commentaire (`comment`) ou d'une œuvre (`work`, `targetId` = identifiant de la partie). */
export const report = pgTable(
  "report",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    reporterId: text("reporter_id").notNull().references(() => user.id),
    reason: text("reason").notNull(),
    details: text("details"),
    // open | resolved (contenu masqué) | dismissed (signalement rejeté)
    status: text("status").notNull().default("open"),
    resolvedBy: text("resolved_by").references(() => user.id),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("report_once").on(t.reporterId, t.targetType, t.targetId), index("report_status_idx").on(t.status, t.createdAt)],
);

/** Demande d'ami (`pending`) puis amitié (`accepted`) ; une seule ligne par paire, dans un sens ou dans l'autre. */
export const friendship = pgTable(
  "friendship",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requesterId: text("requester_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    addresseeId: text("addressee_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("friendship_pair").on(t.requesterId, t.addresseeId), index("friendship_addressee_idx").on(t.addresseeId, t.status)],
);

/** Invitation ciblée d'un ami à une partie : lui donne accès même si la partie est sur invitation. */
export const gameInvitation = pgTable(
  "game_invitation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id").notNull().references(() => game.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    invitedBy: text("invited_by").notNull().references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("game_invitation_once").on(t.gameId, t.userId), index("game_invitation_user_idx").on(t.userId)],
);

export const finalWork = pgTable("final_work", {
  gameId: uuid("game_id").primaryKey().references(() => game.id, { onDelete: "cascade" }),
  imageKey: text("image_key"),
  width: integer("width"),
  height: integer("height"),
  joints: jsonb("joints").$type<{ start: number; end: number }[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
