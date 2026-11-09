# Marketing and advertising

Campaign, funnel, lead, CRM and ad-performance data. Failures here are grain, denominator or
freshness — rarely arithmetic.

## Know what the export is

- **Freshness**: an export pulled Tuesday and analysed Friday is Tuesday's data. Record the
  extract date and as-of date in the input area; do not read a Friday-vs-Tuesday difference as
  performance.
- **Channel setup**: a campaign may span an ad platform, a CRM and a billing system. Name the
  source of each figure before combining them.
- **Grain**: daily rows are not campaign rows. Impressions are not sessions; clicks are not
  leads; leads are not qualified leads; a pipeline total is not revenue.
- **Denominators**: CTR uses impressions; CVR uses sessions or clicks per the platform's
  definition; CPA uses conversions attributed that period. Put the platform's definition in
  the label — vendors' "conversion rate" differ.

## Layout

- Name tabs by content and period: `Leads_Q1_2025`, `Pipeline Analysis`, `ROI Dashboard`.
- Keep the raw import intact on its own sheet; clean in derived columns or a prepared area,
  and record exclusions and mappings (non-target region, test account, renamed source).
- One typed time-series date column with one format. Add an ISO helper column only when a
  downstream import needs it, labelled as such.
- Targets and traffic lights only when the source supplies a target and a direction. No
  invented targets, no green/amber/red on goals nobody set.
- Every dashboard figure traces back to a cell in the prepared data; otherwise it does not go
  on the dashboard.

## Metrics

- Define abbreviations where used (CPC, CPM, CPA, ROAS, MQL) — a legend on the analysis sheet,
  not a glossary tab nobody opens.
- Keep the comparison basis visible: week over week, month over month, or same period last
  year. Mixing bases in one chart is the most common misleading dashboard.
- Attribution: state the model (last click, first click, linear, platform-reported) and keep
  it consistent within a table. Platform- and analytics-reported conversions never reconcile
  exactly; report both.
- Charts only when they make a trend, comparison or funnel clearer than a table. Six
  categories is a table with extra steps.

## Doing it live

- Read first: `info` (sheets, used ranges, whether the user is mid-edit), then
  `read_range --formulas` across the block you will extend.
- Append new periods as rows below the table and extend the table, conditional formatting and
  chart source with them. No second table beside the first.
- For a refresh flag (stale extract, missing platform), use amber input fill plus a note in
  the cell beside it, not an unexplained colour.
- Verify with `read_range --formulas`; a misaligned denominator surfaces as a rate off by a
  factor of ten.
