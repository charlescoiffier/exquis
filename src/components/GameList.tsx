import Link from "next/link";
import { GameMeta } from "@/components/GameMeta";
import { Card } from "@/components/ui/Card";
import { GameTag } from "@/components/GameTag";
import { formatDate } from "@/lib/format";

export type PastGame = {
  id: string;
  name: string;
  type: "drawing" | "text";
  status: string;
  turns: number;
  turnDurationSeconds: number;
  language: string | null;
  creatorName: string;
  createdAt: Date;
  completedAt: Date | null;
  participantCount: number;
};

/** Parties terminées ou annulées : un clic mène directement à l'œuvre. */
export function PastGameList({ games }: { games: PastGame[] }) {
  return (
    <ul className="cards">
      {games.map((g) => (
        <li key={g.id}>
          <Card className="game-card">
            <div className="game-main">
              <Link href={`/games/${g.id}/final`} className="game-title">{g.name}</Link>
              <GameMeta
                type={g.type}
                turns={g.turns}
                turnDurationSeconds={g.turnDurationSeconds}
                language={g.language}
                creatorName={g.creatorName}
                extra={[`${g.participantCount} participant${g.participantCount > 1 ? "s" : ""}`, g.status === "completed" && g.completedAt ? `terminée le ${formatDate(g.completedAt)}` : `commencée le ${formatDate(g.createdAt)}`]}
              />
            </div>
            <div className="game-side"><GameTag kind={g.status === "completed" ? "completed" : "cancelled"} /></div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
