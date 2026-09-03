# Migrate
-- run the command below
npx prisma migrate dev 2>&1

npx prisma migrate dev --name init 2>&1

cd D:\Yibrah\Projects\Lottery\Backend-Lottery; npx --yes prisma migrate dev --name init --skip-generate 2>&1; echo "EXIT:$LASTEXITCODE"

npx prisma migrate deploy 2>&1; echo "EXIT:$LASTEXITCODE"

npx ts-node prisma/seed.ts 2>&1; echo "EXIT:$LASTEXITCODE"

