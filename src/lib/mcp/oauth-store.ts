// The tables behind sign-in for AI apps (#477): apps that registered, one-time codes, grants and
// refresh tokens. Sign-in's rules (oauth-server.ts) reach them through OAuthStore, so tests can use
// one kept in memory; prismaOAuthStore is the real one. Connected apps on the Integrations page
// lists and revokes grants with the functions at the end.
import { Prisma, type PrismaClient } from "@prisma/client";

export type RegisteredClient = { id: string; name: string; redirectUris: string[]; secretHash: string | null };

export type NewAuthorizationCode = {
  codeHash: string;
  userId: string;
  clientId: string;
  clientName: string;
  clientAddress: string;
  redirectUri: string;
  redirectUriSent: boolean;
  codeChallenge: string;
  scopes: string[];
  resource: string;
  expiresAt: Date;
};

/** Whether an account may connect apps: guests and accounts with an unconfirmed email can't. */
export type AccountCheck = { isGuest: boolean; emailVerifiedAt: Date | null };
export const mayConnectApps = (user: AccountCheck) => !user.isGuest && Boolean(user.emailVerifiedAt);

export type StoredAuthorizationCode = NewAuthorizationCode & { usedAt: Date | null; grantId: string | null; accountAllowed: boolean };

export type StoredRefreshToken = {
  id: string;
  grantId: string;
  tokenHash: string;
  scopes: string[];
  resource: string;
  expiresAt: Date;
  createdAt: Date;
  grant: { userId: string; clientId: string; revoked: boolean; accountAllowed: boolean };
};

export type NewRefreshToken = { id: string; tokenHash: string; scopes: string[]; resource: string; expiresAt: Date };

export type OAuthStore = {
  findClient(id: string): Promise<RegisteredClient | null>;
  createClient(client: RegisteredClient, now: Date): Promise<void>;
  createCode(code: NewAuthorizationCode): Promise<void>;
  findCode(codeHash: string): Promise<StoredAuthorizationCode | null>;
  /** Marks a code used. False when a request a moment earlier already did. */
  claimCode(codeHash: string, now: Date): Promise<boolean>;
  /**
   * Joins the app's grant for this account with the code's scopes, or starts one, and adds this
   * device's refresh token. The grant is recorded on the code, so a second use can revoke it.
   */
  connect(input: {
    codeHash: string;
    userId: string;
    clientId: string;
    clientName: string;
    clientAddress: string;
    scopes: string[];
    refreshToken: NewRefreshToken;
    now: Date;
  }): Promise<{ grantId: string }>;
  findRefreshToken(id: string): Promise<StoredRefreshToken | null>;
  /** Gives a refresh token a new secret if it still has `oldHash`. False when another request changed it first. */
  rotateRefreshToken(input: { id: string; oldHash: string; newHash: string; expiresAt: Date; now: Date }): Promise<boolean>;
  /** Ends one device's connection. When it was the app's last device, the grant is revoked too. */
  disconnectDevice(input: { refreshTokenId: string; grantId: string; now: Date }): Promise<void>;
  /** Revokes a grant and deletes its refresh tokens. Its access tokens stop at their next tool call (tools.ts). */
  revokeGrant(grantId: string, now: Date): Promise<void>;
};

const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])];

// A cold Neon start can take longer than Prisma's 5-second default for an interactive transaction.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 15_000 };

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export function prismaOAuthStore(db: PrismaClient): OAuthStore {
  const connectOnce: OAuthStore["connect"] = ({ codeHash, userId, clientId, clientName, clientAddress, scopes, refreshToken, now }) =>
    db.$transaction(async (tx) => {
      const existing = await tx.mcpGrant.findFirst({ where: { userId, clientId, revokedAt: null }, select: { id: true, scopes: true } });
      const grantId = existing
        ? (await tx.mcpGrant.update({ where: { id: existing.id }, data: { clientName, clientAddress, scopes: union(existing.scopes, scopes) }, select: { id: true } })).id
        : (await tx.mcpGrant.create({ data: { userId, clientId, clientName, clientAddress, scopes, createdAt: now }, select: { id: true } })).id;
      await tx.mcpRefreshToken.create({ data: { ...refreshToken, grantId, createdAt: now } });
      await tx.mcpAuthorizationCode.update({ where: { codeHash }, data: { grantId } });
      return { grantId };
    }, TRANSACTION_OPTIONS);

  return {
    findClient: (id) => db.mcpClient.findUnique({ where: { id }, select: { id: true, name: true, redirectUris: true, secretHash: true } }),

    async createClient(client, now) {
      await db.mcpClient.create({ data: { ...client, createdAt: now } });
    },

    async createCode(code) {
      await db.mcpAuthorizationCode.create({ data: code });
    },

    async findCode(codeHash) {
      const row = await db.mcpAuthorizationCode.findUnique({
        where: { codeHash },
        select: {
          codeHash: true,
          userId: true,
          clientId: true,
          clientName: true,
          clientAddress: true,
          redirectUri: true,
          redirectUriSent: true,
          codeChallenge: true,
          scopes: true,
          resource: true,
          expiresAt: true,
          usedAt: true,
          grantId: true,
          user: { select: { isGuest: true, emailVerifiedAt: true } },
        },
      });
      if (!row) return null;
      const { user, ...code } = row;
      return { ...code, accountAllowed: mayConnectApps(user) };
    },

    async claimCode(codeHash, now) {
      const { count } = await db.mcpAuthorizationCode.updateMany({ where: { codeHash, usedAt: null }, data: { usedAt: now } });
      return count === 1;
    },

    async connect(input) {
      try {
        return await connectOnce(input);
      } catch (error) {
        // Two devices connecting the same app at once: one grant per app and account wins, and the other joins it.
        if (!isUniqueViolation(error)) throw error;
        return connectOnce(input);
      }
    },

    async findRefreshToken(id) {
      const row = await db.mcpRefreshToken.findUnique({
        where: { id },
        select: {
          id: true,
          grantId: true,
          tokenHash: true,
          scopes: true,
          resource: true,
          expiresAt: true,
          createdAt: true,
          grant: { select: { userId: true, clientId: true, revokedAt: true, user: { select: { isGuest: true, emailVerifiedAt: true } } } },
        },
      });
      if (!row) return null;
      const { grant, ...token } = row;
      return {
        ...token,
        grant: { userId: grant.userId, clientId: grant.clientId, revoked: Boolean(grant.revokedAt), accountAllowed: mayConnectApps(grant.user) },
      };
    },

    async rotateRefreshToken({ id, oldHash, newHash, expiresAt, now }) {
      const { count } = await db.mcpRefreshToken.updateMany({ where: { id, tokenHash: oldHash }, data: { tokenHash: newHash, expiresAt, rotatedAt: now } });
      return count === 1;
    },

    async disconnectDevice({ refreshTokenId, grantId, now }) {
      await db.$transaction(async (tx) => {
        await tx.mcpRefreshToken.deleteMany({ where: { id: refreshTokenId } });
        const devicesLeft = await tx.mcpRefreshToken.count({ where: { grantId, expiresAt: { gt: now } } });
        if (devicesLeft === 0) await tx.mcpGrant.updateMany({ where: { id: grantId, revokedAt: null }, data: { revokedAt: now } });
      }, TRANSACTION_OPTIONS);
    },

    async revokeGrant(grantId, now) {
      await db.$transaction([
        db.mcpGrant.updateMany({ where: { id: grantId, revokedAt: null }, data: { revokedAt: now } }),
        db.mcpRefreshToken.deleteMany({ where: { grantId } }),
      ]);
    },
  };
}

export type ConnectedApp = {
  id: string;
  clientId: string;
  clientName: string;
  clientAddress: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
};

type GrantDb = Pick<PrismaClient, "mcpGrant" | "mcpRefreshToken" | "$transaction">;

/** The apps connected to an account, newest first, for Connected apps on the Integrations page. */
export function listConnectedApps(db: Pick<PrismaClient, "mcpGrant">, userId: string): Promise<ConnectedApp[]> {
  return db.mcpGrant.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, clientId: true, clientName: true, clientAddress: true, createdAt: true, lastUsedAt: true },
  });
}

/**
 * Disconnect on the Integrations page: revokes the grant and its refresh tokens at once. False when
 * the grant isn't this person's or was already revoked.
 */
export async function disconnectApp(db: GrantDb, userId: string, grantId: string, now: Date) {
  const [revoked] = await db.$transaction([
    db.mcpGrant.updateMany({ where: { id: grantId, userId, revokedAt: null }, data: { revokedAt: now } }),
    db.mcpRefreshToken.deleteMany({ where: { grantId, grant: { userId } } }),
  ]);
  return revoked.count === 1;
}
