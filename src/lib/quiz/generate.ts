// A benchmark instance that did not exist until someone asked for it.
//
// Every trapstreet task pins to a public commit, so its expected answers are
// one search away — fine for a board defended by provenance and reproduction,
// useless for an attempt made in a browser where nothing can be verified. This
// generates a fresh instance per seed instead: the answer is computed here and
// exists nowhere else, so there is nothing to look up and cheating has no
// target.
//
// Difficulty does NOT come from the content. An earlier probe handed a model
// the whole corpus and asked for a three-step lookup; it scored 10/10, and
// flipping whether the answer sat in the text verbatim moved nothing. What is
// hard is not seeing everything at once — so each hop's search key appears
// ONLY inside the previous hop's section. The chain cannot be walked in
// parallel and it cannot be guessed; it has to be followed.

export interface QuizHop {
  /** What you must search for to find this section. */
  key: string;
  sectionId: string;
}

export interface QuizSection {
  id: string;
  title: string;
  body: string;
}

export interface Quiz {
  seed: number;
  sections: QuizSection[];
  question: string;
  /** Held by the page, never handed to an agent. */
  answer: string;
  chain: QuizHop[];
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REQUESTS = [
  "vendor onboarding", "contractor badge", "data export", "legal hold",
  "payment terms change", "access tier upgrade", "equipment write-off",
  "travel advance", "records disposal", "subprocessor addition",
];
const ROLE_WORDS = [
  "Regional Controller", "Records Custodian", "Duty Principal",
  "Standing Reviewer", "Clearing Officer", "Field Registrar",
  "Continuity Warden", "Schedule Marshal",
];
const FIRST = ["Aline", "Bertrand", "Cosima", "Dmitri", "Eun-ji", "Fabio",
  "Greta", "Halldór", "Ines", "Jarrah", "Kwame", "Liesel", "Mira", "Nuno",
  "Orsolya", "Priya", "Quentin", "Rafiq", "Sunniva", "Tomas"];
const LAST = ["Vandermeer", "Okonkwo", "Halvorsen", "Castellanos", "Abernathy",
  "Fontaine", "Bergström", "Nakagawa", "Oyelaran", "Petrosyan", "Quintero",
  "Rasmussen", "Sørensen", "Thackeray"];

const pick = <T,>(rng: () => number, xs: readonly T[]): T =>
  xs[Math.floor(rng() * xs.length)];

// Second halves that pair plausibly with the first word of a request, so a
// decoy shares vocabulary with the real entry instead of being about some
// unrelated subject.
const VARIANT_TAILS = [
  "addition", "removal", "renewal", "review", "amendment", "extension",
  "onboarding", "offboarding", "export", "import", "hold", "release",
  "upgrade", "downgrade", "advance", "reconciliation", "disposal",
  "write-off", "badge", "change",
];

/**
 * Near misses for the entry hop. Searching the request type named in the
 * question used to return exactly ONE title — nothing to choose between,
 * so the first step was free. These share the request's own words, which
 * is what makes them show up beside it and what makes reading necessary.
 */
function entryDecoys(rng: () => number, request: string, howMany: number): string[] {
  const words = request.split(" ");
  const head = words.slice(0, -1).join(" ") || request;
  const tail = words[words.length - 1];

  const out = new Set<string>();
  let guard = 0;
  while (out.size < howMany && guard++ < 200) {
    // Half keep the subject and change what is being done to it; half keep
    // the action and change the subject. Either way a search for the real
    // request hits them.
    const variant =
      rng() < 0.5
        ? `${head} ${pick(rng, VARIANT_TAILS)}`
        : `${pick(rng, REQUESTS).split(" ").slice(0, -1).join(" ") || "vendor"} ${tail}`;
    if (variant !== request && variant.trim()) out.add(variant);
  }
  return [...out];
}

/** A desk code like `LX-4471` — meaningless until you have read it somewhere. */
const code = (rng: () => number) => {
  const letters = "BCDFGHJKLMNPQRSTVWXZ";
  return (
    letters[Math.floor(rng() * letters.length)] +
    letters[Math.floor(rng() * letters.length)] +
    "-" +
    String(1000 + Math.floor(rng() * 9000))
  );
};

const person = (rng: () => number) => `${pick(rng, FIRST)} ${pick(rng, LAST)}`;

export function generateQuiz(opts: {
  seed: number;
  hops?: number;
  distractors?: number;
}): Quiz {
  const { seed, hops = 3, distractors = 8 } = opts;
  const rng = mulberry32(seed);

  const request = pick(rng, REQUESTS);
  const threshold = (2 + Math.floor(rng() * 18)) * 500;

  // Keys are minted first so each section can name the next one. keys[0] is
  // the request type, which the question is allowed to state; everything
  // after it is discoverable only by reading.
  const keys: string[] = [request];
  for (let i = 1; i < hops; i++) {
    keys.push(i % 2 === 1 ? code(rng) : pick(rng, ROLE_WORDS));
  }
  const answer = person(rng);

  const sections: QuizSection[] = [];
  const chain: QuizHop[] = [];

  for (let i = 0; i < hops; i++) {
    const id = `s${i + 1}`;
    const key = keys[i];
    const next = keys[i + 1];
    const last = i === hops - 1;

    const title = i === 0 ? `Routing — ${key}` : `${key} — standing arrangements`;
    const body = last
      ? `Anything routed here above ${threshold} is signed off by ${answer}, ` +
        `who holds this responsibility until further notice. Do not re-route ` +
        `such items; ${answer} signs them personally.`
      : i === 0
        ? `All ${key} submissions are handled by the ${next} desk. The desk's ` +
          `standing arrangements govern what happens above the review threshold.`
        : `${key} escalates to ${next} for anything above ${threshold}. Below ` +
          `that figure it is cleared in place and never leaves this desk.`;

    sections.push({ id, title, body });
    chain.push({ key, sectionId: id });
  }

  // Near misses: same shape, same vocabulary, different values. A search that
  // stops at the first plausible hit lands on one of these and produces a
  // confident wrong answer.
  // The entry hop gets its near misses first; the rest are ordinary decoys.
  const nearMisses = entryDecoys(rng, request, Math.min(3, distractors));

  for (let d = 0; d < distractors; d++) {
    const otherRequest = nearMisses[d] ?? pick(rng, REQUESTS);
    const otherCode = code(rng);
    const otherRole = pick(rng, ROLE_WORDS);
    const otherPerson = person(rng);
    // A near miss is only useful if it wears the entry hop's shape.
    const shape = d < nearMisses.length ? 0 : Math.floor(rng() * 3);
    const body =
      shape === 0
        ? `All ${otherRequest} submissions are handled by the ${otherCode} desk.`
        : shape === 1
          ? `${otherCode} escalates to ${otherRole} for anything above ${(2 + d) * 500}.`
          : `Items routed here are signed off by ${otherPerson} under the ` +
            `standing delegation.`;
    sections.push({
      id: `d${d + 1}`,
      title:
        shape === 0
          ? `Routing — ${otherRequest}`
          : shape === 1
            ? `${otherCode} — standing arrangements`
            : `${otherRole} — standing arrangements`,
      // Never the real answer, or a decoy becomes a shortcut.
      body: body.split(answer).join(otherPerson),
    });
  }

  return {
    seed,
    sections,
    question:
      // "A equipment write-off" is the first sentence a judge reads.
      `${/^[aeiou]/i.test(request) ? "An" : "A"} ${request} request has come in for ${threshold + 500}. ` +
      `Who signs it off? Answer with the person's full name and nothing else.`,
    answer,
    chain,
  };
}
