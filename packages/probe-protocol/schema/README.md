# schema/

JSON Schema (draft 2020-12) de chaque message du protocole de sonde (`<type>.schema.json`) et de
leur union (`probe-message.schema.json`). **Générés** depuis les schémas Zod de `src/messages.ts`
par `npm run schemas` ; jamais modifiés à la main (`test/schema.test.ts` vérifie l'égalité).
Les champs inconnus sont permis (`additionalProperties` absent) : compatibilité mineure (P-03).
