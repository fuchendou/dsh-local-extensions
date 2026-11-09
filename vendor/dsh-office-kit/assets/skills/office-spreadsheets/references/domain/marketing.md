# Marketing and advertising

Campaign work is a funnel plus a spend table, and both are easy to make look better than they are.

- One row per campaign, channel, or creative, with that grain named in the header. Mixing a channel total into a campaign table double counts.
- The funnel reads spend → impressions → clicks → conversions → revenue in that order, with rates derived by formula: `CTR = clicks / impressions`, `CVR = conversions / clicks`, `CPA = spend / conversions`, `ROAS = revenue / spend`.
- Never compute a ratio from cells that are not the same period and the same population. A monthly CTR built from a quarterly spend and a weekly click count is a number nobody can defend.
- Attribution is a claim: say which model the numbers use (last click, platform reported, blended) and keep it constant across the table. Do not add platform conversions together and call it incremental revenue.
- Missing spend or reach for a period is blank, not zero — a zero-spend month shows an infinite CPA and a fake collapse in the trend.
- Benchmarks and targets belong in a labelled row or column with their source, not in a note the reader has to find.

## Charts for marketing

Put spend and return on one chart only when both use the same unit; otherwise two aligned charts. Sort channel bars by spend or by return, not alphabetically, and keep the same order across charts. A conversion trend belongs on a line chart with the campaign launch dates marked, not on a pie.
