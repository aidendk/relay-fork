-- Default carYear to the current season's car (June–May, UTC), so any insert that
-- doesn't set it — e.g. code deployed before this column existed — still succeeds.
ALTER TABLE "Order" ALTER COLUMN "carYear" SET DEFAULT (
    'AME' || (
        (EXTRACT(YEAR FROM timezone('UTC', now()))::int % 100)
        + CASE WHEN EXTRACT(MONTH FROM timezone('UTC', now())) >= 6 THEN 1 ELSE 0 END
    )
);
