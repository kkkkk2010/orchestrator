import assert from "node:assert/strict";
import { createJobSchema } from "../schema";

const makePayload = (endpoint = "https://www.presentonika.ru/wp-json/presentonika/v1/save-outzip") => ({
  presentationId: 123,
  userId: 7,
  topic: "Александр Пушкин",
  themeId: "teacher-dark",
  save: {
    endpoint,
    presentationId: 123,
    saveToken: "test-token",
  },
});

export const runSchemaTests = (): void => {
  assert.equal(createJobSchema.safeParse(makePayload()).success, true);
  assert.equal(createJobSchema.safeParse({
    ...makePayload(),
    save: { ...makePayload().save, presentationId: 124 },
  }).success, false);

  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.equal(createJobSchema.safeParse(makePayload("https://example.com/save")).success, false);
    assert.equal(createJobSchema.safeParse(makePayload("http://www.presentonika.ru/save")).success, false);
    assert.equal(createJobSchema.safeParse(makePayload()).success, true);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
};
