import { isSafeAppPath, safeReturnPath } from "@/lib/auth-return";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function testSafePaths() {
  assert(isSafeAppPath("/sentinel/market-condition"), "flow path ok");
  assert(
    isSafeAppPath("/sentinel/market-condition?theme=AI_INFRA&chart=SMCI"),
    "flow query ok"
  );
  assert(!isSafeAppPath("https://evil.example/"), "absolute rejected");
  assert(!isSafeAppPath("//evil.example"), "protocol-relative rejected");
  assert(!isSafeAppPath("/sentinel/login"), "login loop rejected");
  assert(!isSafeAppPath("/sentinel/login?next=/x"), "login query rejected");
}

function testReturnPath() {
  assert(safeReturnPath(null) === "/sentinel/market-condition", "null default");
  assert(
    safeReturnPath("/sentinel/market-condition?theme=AI_INFRA&chart=SMCI") ===
      "/sentinel/market-condition?theme=AI_INFRA&chart=SMCI",
    "preserves chart deep link"
  );
  assert(safeReturnPath("https://evil.example/") === "/sentinel/market-condition", "unsafe default");
}

testSafePaths();
testReturnPath();
console.log("auth-return tests passed");
