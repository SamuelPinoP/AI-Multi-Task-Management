import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL!;

const pool = new Pool({
  connectionString,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const DEMO_PASSWORD_HASH = "scrypt:ae642129353a2e731fed96d40cad35b4:ed748ab376d5a11aa3fd3ea1d8778aeba286861c765a2b42083c9e2aae50e9c351cda4ce361c9fcf3dfc970e1d5561f4fe95f7d81ab4289f4c0b876c654f672b";

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "samuel@example.com" },
    update: { passwordHash: DEMO_PASSWORD_HASH },
    create: {
      email: "samuel@example.com",
      name: "Samuel",
      passwordHash: DEMO_PASSWORD_HASH,
    },
  });

  console.log("Seeded user:", user);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });