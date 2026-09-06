// What the numbers on this map mean, and what they do not.
//
// Everything here is read from `manifest.json` at runtime rather than typed in.
// That is the point: a methodology page whose figures are hand-copied drifts from
// the pipeline the first month somebody forgets, and a stale methodology page is
// worse than none. If the pipeline stops publishing a figure, the section that
// quotes it disappears rather than lying.

import { useEffect, useState } from "react";
import { fetchManifest, type Manifest } from "@/lib/manifest";

interface Backtest {
  origins: { total: number; calibration: number; evaluation: number;
             effective_independent: number };
  coverage: {
    nominal: number;
    random_walk_sqrt_h: Record<string, number>;
    ar1_closed_form: Record<string, number>;
    empirical_quantiles: Record<string, number>;
  };
  mase: Record<string, number>;
  mae_log_x100: Record<string, number>;
  naive_mae_log_x100: Record<string, number>;
  beats_naive: boolean;
  eligible_zips: number;
  complete_history_zips: number;
}

interface Noise {
  K: number;
  K_lag: number[];
  K_lag_used: number;
  plateau_ratio: number;
  K_by_sample_size: Record<string, number | null>;
  tiers: Record<string, number>;
  tier_n_implied: number[];
  rankable_zips: number;
  reporting_zips: number;
  rankable_rse: number;
  rankable_n_implied: number;
  per_metric: Record<string, { K: number }>;
}

interface Spatial {
  n: number;
  k_shipped: number;
  permutations: number;
  fdr_q: number;
  moran_I_by_k: Record<string, number>;
  class_counts: Record<string, number>;
  lisa_median_n_by_class: Record<string, number | null>;
  bh_significant: number;
  bonferroni_threshold: number;
  bonferroni_attainable: boolean;
  permutations_for_bonferroni: number;
  median_8th_neighbour_km: number;
}

const H = ["1", "3", "6", "12"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold mb-3 text-foreground">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-xs tabular-nums border-collapse my-3">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="text-left font-semibold border-b border-border px-3 py-1">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="border-b border-border/50 px-3 py-1">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Methodology() {
  const [mf, setMf] = useState<Manifest | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchManifest().then(setMf).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="p-8 text-sm text-muted-foreground">Could not load: {err}</div>;
  if (!mf) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  const noise = mf.noise as unknown as Noise;
  const spatial = mf.spatial as unknown as Spatial | undefined;
  const backtest = (mf.forecast as unknown as { backtest?: Backtest } | undefined)?.backtest;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-bold mb-2 text-foreground">How these numbers are made</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Data through {mf.redfin.period_end} (Redfin, rolling three months) and{" "}
        {mf.zhvi.period_end} (Zillow ZHVI). Every figure below is read from the
        release that built this map, not typed in.
      </p>

      <Section title="A median over four sales is not a median over four hundred">
        <p>
          Most of this map rests on one idea. When a ZIP reports a median sale
          price, that number is an estimate from however many homes actually sold
          there — sometimes 400, more often fewer than a dozen. Painting both the
          same colour with the same confidence is the single most common thing
          wrong with housing choropleths.
        </p>
        <p>
          Order-statistic theory gives the standard error of a median as{" "}
          <code>K / sqrt(n)</code> once you take logs, where <code>n</code> is the
          number of sales and <code>K</code> is a scale constant. We fit{" "}
          <code>K</code> from the data rather than assuming it, by comparing each
          period against the average of the periods before and after it —
          local price trend cancels in that difference, and what is left is
          sampling noise.
        </p>
        <p>
          <strong>K = {noise.K}</strong> for median sale price on this release.
        </p>
      </Section>

      <Section title="Why the fit uses a three-period lag">
        <p>
          Redfin's ZIP window is a rolling three months, so consecutive rows share
          two of their three months of transactions and their errors are
          correlated. The estimator assumes independence, so at short lags it
          recovers only a fraction of the true K. Lag {noise.K_lag_used} is the
          first with no shared transactions; beyond it the assumption that prices
          move locally in a straight line starts to degrade.
        </p>
        <Table
          head={["lag", ...noise.K_lag.map((_, i) => String(i + 1))]}
          rows={[["K", ...noise.K_lag.map((k) => k.toFixed(4))]]}
        />
        <p>
          The plateau is the evidence: K at lag {noise.K_lag_used + 1} is{" "}
          {noise.plateau_ratio.toFixed(3)}× the shipped value. If it kept climbing,
          the fit would be measuring trend rather than noise.
        </p>
      </Section>

      <Section title="Does 1/sqrt(n) actually hold? Refit inside sample-size buckets">
        <p>
          A single pooled constant cannot be checked against anything. Refitting
          K separately inside sample-size buckets can be — if the form is right, K
          should be roughly flat across them.
        </p>
        <Table
          head={["sales", ...Object.keys(noise.K_by_sample_size)]}
          rows={[["K", ...Object.values(noise.K_by_sample_size).map((v) => v?.toFixed(4) ?? "—")]]}
        />
        <p>
          <strong>The thin buckets carry the highest K, and that is a limitation
          worth stating.</strong> A single pooled constant therefore makes the
          error bars slightly too narrow for exactly the ZIPs that need them
          widest. A per-quartile or per-metro K is the first refinement.
        </p>
      </Section>

      <Section title="Reliability tiers, and the one threshold used everywhere">
        <p>
          The tiers are cuts on the relative standard error, not on sample size.
          The sample sizes below are what those cuts imply at this release's K —
          they move when K moves, which is why the threshold is quoted as a
          percentage first.
        </p>
        <Table
          head={["tier", "relative standard error", "implied sales", "ZIPs"]}
          rows={[
            ["high", "under 4%", `${noise.tier_n_implied[2]}+`, noise.tiers["3"]?.toLocaleString() ?? "—"],
            ["good", "4–6%", `${noise.tier_n_implied[1]}+`, noise.tiers["2"]?.toLocaleString() ?? "—"],
            ["fair", "6–10%", `${noise.tier_n_implied[0]}+`, noise.tiers["1"]?.toLocaleString() ?? "—"],
            ["low", "10% or more", `under ${noise.tier_n_implied[0]}`, noise.tiers["0"]?.toLocaleString() ?? "—"],
          ]}
        />
        <p>
          One threshold — a relative standard error under{" "}
          {(noise.rankable_rse * 100).toFixed(0)}%, which is{" "}
          {noise.rankable_n_implied} sales on this release — decides three things,
          so it only has to be explained once: which ZIPs may set the national
          colour scale, which are eligible for the cluster analysis, and which
          count as “rankable”. {noise.rankable_zips.toLocaleString()} of{" "}
          {noise.reporting_zips.toLocaleString()} reporting ZIPs clear it.
        </p>
        <p>
          <strong>That has a cost, and it is not neutral.</strong> ZIPs below the
          threshold are cheaper on average, so restricting the colour scale to
          rankable ZIPs paints thin and rural markets against a scale set without
          them. They still render, at reduced opacity, and they keep their real
          values.
        </p>
        <p>
          The reliability fade has no off switch. It is the honesty layer, and a
          toggle would mostly be used to turn it off for a screenshot.
        </p>
      </Section>

      <Section title="Per-metric K: one constant does not cover three statistics">
        <p>
          K is <code>1.2533 × sd(log x)</code>. The spread of log days-on-market has
          nothing to do with the spread of log price, so each statistic gets its
          own fit. Reusing one would be wrong by the ratios below.
        </p>
        <Table
          head={["series", "K"]}
          rows={[
            ["median sale price", noise.K.toFixed(4)],
            ...Object.entries(noise.per_metric ?? {}).map(([m, v]) => [m, v.K.toFixed(4)]),
          ]}
        />
      </Section>

      {backtest && (
        <Section title="The forecast, and what its error bars actually achieved">
          <p>
            Monthly ZHVI growth is strongly autocorrelated, which points at an
            AR(1) on growth — the same model as a damped local trend, or
            ARIMA(1,1,0) with a constant. Stating that equivalence is cheaper than
            buying the machinery: the closed form runs in microseconds per ZIP
            where a general implementation takes milliseconds.
          </p>
          <p>
            <strong>The interval is where the obvious approach fails.</strong>{" "}
            Scaling the one-step error by <code>sqrt(h)</code> is the correct
            multi-step variance for a random walk — but we did not fit a random
            walk. Below is what each method promised (80%) against what it
            delivered out of sample, over {backtest.origins.evaluation} evaluation
            origins.
          </p>
          <Table
            head={["method", ...H.map((h) => `h=${h}`)]}
            rows={[
              ["random walk, sigma×sqrt(h)", ...H.map((h) => pct(backtest.coverage.random_walk_sqrt_h[h]))],
              ["AR(1) own closed form", ...H.map((h) => pct(backtest.coverage.ar1_closed_form[h]))],
              ["empirical quantiles (shipped)", ...H.map((h) => pct(backtest.coverage.empirical_quantiles[h]))],
            ]}
          />
          <p>
            Most of the gap is using a random-walk variance for a model that is not
            a random walk. Empirical calibration closes the rest, and that
            remainder is non-normality.
          </p>
          <Table
            head={["horizon", ...H.map((h) => `h=${h}`)]}
            rows={[
              ["AR(1) mean abs. log error ×100", ...H.map((h) => backtest.mae_log_x100[h])],
              ["naive (last value carried forward)", ...H.map((h) => backtest.naive_mae_log_x100[h])],
              ["MASE (under 1.0 beats naive)", ...H.map((h) => backtest.mase[h])],
            ]}
          />
          <p>
            <strong>{backtest.origins.total} origins are worth about{" "}
            {backtest.origins.effective_independent} independent ones.</strong> The
            origins are quarterly and the longest horizon is twelve months, so the
            test windows overlap by nine. Quoting the nominal count would overstate
            the evidence roughly fourfold.
          </p>
          <p>
            The headline runs over the {backtest.eligible_zips.toLocaleString()}{" "}
            ZIPs with at least five years of history, not the{" "}
            {backtest.complete_history_zips.toLocaleString()} with complete
            history. Complete history is a survivorship filter — it selects large,
            established, continuously transacting markets — and reporting it as the
            headline would flatter the model.
          </p>
          <p>
            <strong>Zillow revises ZHVI retroactively across its whole history
            between releases</strong>, so what this backtest could “know” at each
            origin is not what was actually knowable then. The errors above are
            optimistic by an unknown amount. Each monthly vintage is being archived
            from now on so a genuine point-in-time evaluation becomes possible.
          </p>
          <p className="text-xs italic">
            Statistical extrapolations of a third-party index with measured error
            bands. Not investment advice.
          </p>
        </Section>
      )}

      {spatial && (
        <Section title="Price clusters, and why they are gated">
          <p>
            Local Moran's I asks whether a ZIP's price agrees with its neighbours'.
            Run over every reporting ZIP, it produces a satisfying-looking map of
            rare “price islands” — and that map is mostly an artifact. Sampling
            noise pushes a thin ZIP away from its neighbourhood mean, which is
            precisely the definition of a spatial outlier.
          </p>
          <p>
            The diagnostic that settles it is the median number of sales in each
            class. Ungated, the outlier classes had a handful of sales each while
            the clusters had dozens. Gated to rankable ZIPs only, they no longer
            separate by sample size, which is what makes the survivors real:
          </p>
          <Table
            head={["class", ...Object.keys(spatial.class_counts)]}
            rows={[
              ["ZIPs", ...Object.values(spatial.class_counts).map((v) => v.toLocaleString())],
              ["median sales", ...Object.keys(spatial.class_counts).map(
                (k) => spatial.lisa_median_n_by_class[k] ?? "—")],
            ]}
          />
          <p>
            Gating rebuilds the neighbour graph rather than just dropping rows —
            the {spatial.k_shipped} nearest neighbours among{" "}
            {spatial.n.toLocaleString()} rankable ZIPs are much further apart than
            among all of them — so no ungated figure carries over. The median
            distance to the {spatial.k_shipped}th neighbour here is{" "}
            {spatial.median_8th_neighbour_km} km.
          </p>
          <p>
            <strong>Global Moran's I depends on how many neighbours you count</strong>,
            so quoting one number without the weights is meaningless:
          </p>
          <Table
            head={["neighbours", ...Object.keys(spatial.moran_I_by_k)]}
            rows={[["Moran's I", ...Object.values(spatial.moran_I_by_k)]]}
          />
          <p>
            Nearest-neighbour weights are asymmetric, which invalidates the
            closed-form variance, so all inference here is by permutation —{" "}
            {spatial.permutations.toLocaleString()} conditional permutations, with
            Benjamini–Hochberg false-discovery control at q ={" "}
            {spatial.fdr_q}. {spatial.bh_significant.toLocaleString()} ZIPs clear it.
          </p>
          <p>
            <strong>Bonferroni is not merely conservative here; it is
            unreachable.</strong> The threshold would be{" "}
            {spatial.bonferroni_threshold.toExponential(2)}, while the smallest
            p-value {spatial.permutations.toLocaleString()} permutations can even
            produce is {(1 / (spatial.permutations + 1)).toExponential(2)}.
            Attaining it would take about{" "}
            {spatial.permutations_for_bonferroni.toLocaleString()} permutations.
            That arithmetic is the reason for false-discovery control rather than a
            preference for it.
          </p>
          <p>
            Two honesty notes. This is <strong>descriptive clustering with a
            permutation screen, not a hypothesis test</strong>: the null being
            tested is complete spatial randomness, which the global statistic has
            already rejected everywhere. And Benjamini–Hochberg under spatial
            dependence is valid under positive regression dependency, which is an
            assumption rather than a fact.
          </p>
        </Section>
      )}

      <Section title="Two things about the source data that look like bugs and are not">
        <p>
          <strong>The map shows a rolling three-month window, never a month.</strong>{" "}
          It runs {mf.redfin.period_begin} to {mf.redfin.period_end}. The window is
          89 to 92 days depending on the calendar, so no single day count describes
          it and none is published.
        </p>
        <p>
          <strong>Zillow's index has a month-over-month change and Redfin's
          metrics do not.</strong> That asymmetry is deliberate on Redfin's side:
          consecutive ZIP windows overlap by two thirds and the data is not
          seasonally adjusted, so a month-over-month figure would be dominated by
          overlap and season. Zillow's index is smoothed and seasonally adjusted on
          real calendar months, so its month-over-month means what it says.
        </p>
        <p>
          Every year-over-year figure here is recomputed from published levels at a
          twelve-month lag, in each metric's own unit — percent for prices and
          counts, percentage points for shares, and whole days or months for
          days-on-market and months-of-supply. Redfin publishes those last two
          under a percent label that they are not; recomputing means those columns
          are never read.
        </p>
      </Section>
    </main>
  );
}
