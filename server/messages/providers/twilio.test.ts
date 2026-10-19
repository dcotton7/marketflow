import assert from "node:assert/strict";
import { isValidTwilioSignature } from "./twilio";

// Worked example from Twilio's "Webhooks security" docs.
const url = "https://example.com/myapp.php?foo=1&bar=2";
const params = {
  Digits: "1234",
  To: "+18005551212",
  From: "+14158675310",
  Caller: "+14158675310",
  CallSid: "CA1234567890ABCDE",
};
const good = "L/OH5YylLD5NRKLltdqwSvS0BnU=";

assert.equal(isValidTwilioSignature(url, params, good, "12345"), true);
assert.equal(isValidTwilioSignature(url, { ...params, Digits: "9999" }, good, "12345"), false, "tampered body");
assert.equal(isValidTwilioSignature(url, params, good, "wrong"), false, "wrong token");
assert.equal(isValidTwilioSignature(url, params, undefined, "12345"), false, "no signature");
assert.equal(isValidTwilioSignature(url, params, good, ""), false, "no token configured");

console.log("twilio signature ok");
