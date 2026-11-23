# Database migrations

Schema migrations live in `prisma/migrations`. Apply them with Prisma, not `prisma db push`.

## Fresh database

Run:

```sh
npx prisma migrate deploy
```

## Existing database created with `prisma db push`

Tables created earlier with `prisma db push` have no migration history, so mark the
migrations that already match the schema as applied before deploying the rest:

```sh
npx prisma migrate resolve --applied 0_init
# Only if the AiProvider and AiSettings tables already exist:
npx prisma migrate resolve --applied 20260830071048_add_ai_provider_config
# Only if the Conversation table already exists:
npx prisma migrate resolve --applied 20261123000000_add_conversation
npx prisma migrate deploy
```
