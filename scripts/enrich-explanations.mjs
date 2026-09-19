import { readFile, writeFile } from "node:fs/promises";

const dataPath = new URL("../data/ccse-2026-questions.json", import.meta.url);
const sourceIndex = "https://apruebaccse.es/preguntas/";

const data = JSON.parse(await readFile(dataPath, "utf8"));
const indexHtml = await (await fetch(sourceIndex)).text();
const links = new Map();
for (const match of indexHtml.matchAll(/href="([^"]*\/pregunta\/([0-9]+)-[^"]+)"/g)) {
  links.set(Number(match[2]), new URL(match[1], sourceIndex).href);
}

if (links.size !== data.questions.length) {
  throw new Error(`Expected ${data.questions.length} source links, found ${links.size}`);
}

const explanations = new Map();
await Promise.all(data.questions.map(async (question) => {
  const html = await (await fetch(links.get(question.id))).text();
  const jsonLd = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)]
    .map((match) => JSON.parse(answerJson(match[1])))
    .find((value) => value.mainEntity?.acceptedAnswer?.text);
  const answerText = jsonLd?.mainEntity.acceptedAnswer.text;
  const answer = question.options?.[question.answer] ?? question.answer;
  let explanation = answerText?.replace(new RegExp(`^${escapeRegExp(answer)}\\s*`, "i"), "").trim();
  if (explanation === answerText) explanation = answerText?.slice(answerText.indexOf(".") + 1).trim();
  if (!explanation || explanation === answerText) throw new Error(`Missing explanation for question ${question.id}`);
  explanations.set(question.id, explanation);
}));

for (const question of data.questions) question.explanation = explanations.get(question.id);
await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`);

function answerJson(value) {
  return value.replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
