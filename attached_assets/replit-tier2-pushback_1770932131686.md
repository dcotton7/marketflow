# Pushback on Deferring Thought-Level Learning (Tier 2)

## The Scenario

I agree that pattern type classification (Tier 3) can wait. But Thought-level
learning (Tier 2) should move up to Phase 3, not Phase 4. Here's why.

If I tell the AI to loosen Volume Dry Up on 10 different ideas and it works
every time, the system should learn that. Without Thought-level awareness,
when I create idea #11 that also uses Volume Dry Up, the AI will suggest
the tight default again and I'll have to ask it to loosen it for the 11th
time. That's a bad user experience.

This doesn't require pattern type tags or the aggregates table. It's just
a query change when building the AI prompt.

## What It Looks Like

Right now (Tier 1 only), the prompt query is:

```sql
SELECT * FROM tuning_history WHERE ideaId = :currentIdeaId
```

Tier 2 at the single-user level just adds:

```sql
SELECT * FROM tuning_history
WHERE userId = :currentUserId
  AND :thoughtName = ANY(thoughtsInvolved)
  AND ideaId != :currentIdeaId
```

That's it. No new tables, no aggregation jobs, no pattern classification.
Just a second query that asks "what has this user done with the Volume Dry
Up Thought across ALL their ideas?"

If the answer is "loosened maxRatio 10 out of 10 times, rated helpful every
time," the AI prompt includes that as supporting context and either stops
suggesting the tight default or suggests the user's preferred value from
the start.

## When It Pays Off

This doesn't need thousands of users or hundreds of sessions. It pays off
as soon as one user tunes the same Thought across 3-4 different ideas.
That'll happen in the first week of real usage.

## Suggested Phasing

- Phase 1: Scan sessions + rich ratings (unchanged)
- Phase 2: Apply toggle + rescan + comparison + feedback (unchanged)
- Phase 3: Tier 1 idea-specific history in AI prompt + Tier 2 single-user
  Thought-level query (the second query above, added to the same prompt)
- Phase 4+: Pattern type classification, cross-user aggregates, SaaS tiering
