// What the numbers on this map mean, and what they do not.
//
// Everything here is read from `manifest.json` at runtime rather than typed in.
// That is the point: a methodology page whose figures are hand-copied drifts from
// the pipeline the first month somebody forgets, and a stale methodology page is
// worse than none. If the pipeline stops publishing a figure, the section that
// quotes it disappears rather than lying.
//
// ON THE REGISTER, because it was rewritten once for it. Each numbered section
// opens with a short statement a reader with no statistics can follow, and the
// derivations, constants and diagnostics sit under a "Statistical detail"
// disclosure beneath it. Nothing was deleted in that move. The earlier version
// built every section to a rhetorical turn ("and that map is mostly an
// artifact", "that has a cost, and it is not neutral"), bolded its own verdicts
// mid-paragraph, and ordered the material the way the pipeline runs rather than
// the way a reader needs it. Methodology sections in the BLS Handbook of Methods,
// Eurostat quality reports and journal Methods sections do none of that: headings
// name their subject, tables carry captions and units, notation is defined once,
// and limitations get a numbered section instead of being scattered as asides.
// Match that when editing.

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { fetchManifest, type Manifest } from "@/lib/manifest";
import { TopBarShell } from "@/components/dashboard/TopBar";

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

const SECTIONS = [
  ["1", "Sources and reference periods"],
  ["2", "Classification of values into colours"],
  ["3", "Precision of the estimates"],
  ["4", "Twelve-month forecast"],
  ["5", "Price outliers"],
  ["6", "Series redefined by the source in May 2026"],
  ["7", "Limitations"],
  ["8", "Notation and glossary"],
] as const;

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section id={`s${n}`} className="mb-10 scroll-mt-20">
      <h2 className="text-base font-semibold mb-3 text-foreground">
        <span className="tabular-nums text-muted-foreground mr-2">{n}</span>
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

/** The derivations, constants and diagnostics for the section above it. Closed by
 *  default so the page reads end to end without them, open for anyone checking
 *  the work. */
function Detail({ children }: { children: React.ReactNode }) {
  return (
    <details className="mt-4 rounded-md border border-border bg-muted/30 px-3 py-2">
      <summary className="cursor-pointer text-xs font-semibold text-foreground select-none">
        Statistical detail
      </summary>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

function Table({
  n, caption, head, rows,
}: {
  n: string;
  caption: string;
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <figure className="my-4">
      <div className="overflow-x-auto">
        <table className="text-xs tabular-nums border-collapse w-full">
          <thead>
            <tr>
              {head.map((h, i) => (
                <th
                  key={h}
                  className={`font-semibold border-b border-border px-3 py-1.5 ${i === 0 ? "text-left" : "text-right"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td
                    key={j}
                    className={`border-b border-border/50 px-3 py-1.5 ${j === 0 ? "text-left" : "text-right"}`}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="mt-1.5 text-xs text-muted-foreground">
        <span className="font-semibold">Table {n}.</span> {caption}
      </figcaption>
    </figure>
  );
}

function Term({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-1.5 border-b border-border/40">
      <dt className="text-xs font-semibold text-foreground">{name}</dt>
      <dd className="text-xs text-muted-foreground leading-relaxed">{children}</dd>
    </div>
  );
}

export default function Methodology() {
  const [mf, setMf] = useState<Manifest | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchManifest().then(setMf).catch((e) => setErr(String(e)));
  }, []);

  // index.html carries one hard-coded canonical pointing at the map, and it is
  // in the served HTML for every route. Left alone, a crawler that follows the
  // sitemap to /methodology is told the page's canonical URL is the homepage
  // and drops it from the index, so the sitemap entry would do nothing. Swap both
  // the title and the canonical while this page is mounted, and restore them so
  // a client-side return to the map does not keep them.
  useEffect(() => {
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const prevTitle = document.title;
    const prevHref = canonical?.href;
    document.title = "Methodology | Domapus";
    if (canonical) canonical.href = "https://jasperwchen.github.io/Domapus/methodology";
    return () => {
      document.title = prevTitle;
      if (canonical && prevHref) canonical.href = prevHref;
    };
  }, []);

  const body = () => {
    if (err) return <p className="text-sm text-muted-foreground">Could not load: {err}</p>;
    if (!mf) return <p className="text-sm text-muted-foreground">Loading…</p>;
    return <Body mf={mf} />;
  };

  return (
    <div className="min-h-screen bg-dashboard-bg">
      <TopBarShell subtitle="Methodology" nav="map" />
      <main className="max-w-3xl mx-auto px-6 py-10">
        {/* Above the title, and outside `body()` on purpose: if the manifest
            fails this page renders one line of error text, and that is exactly
            when the reader most needs a way out. The header's map icon is the
            only other exit and it carries no label below `xl`. */}
        <BackToMap className="mb-6" />
        {body()}
      </main>
    </div>
  );
}

/**
 * The way back to the map.
 *
 * A real navigation rather than a `<Link>`, for the reason `TopBar` sets out:
 * `index.html` starts the manifest and paint fetches during head parse, and a
 * client-side mount cannot, so routing into the map would trade this page's
 * exit for a slower first paint on arrival.
 *
 * The query string comes along because the map keeps its whole view there,
 * metric, selected ZIP, centre and zoom. Dropping it would return the reader to
 * the national default instead of the place they left.
 */
function BackToMap({ className = "" }: { className?: string }) {
  const { search } = useLocation();
  return (
    <a
      href={`${import.meta.env.BASE_URL}${search}`}
      className={`inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors ${className}`}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to map
    </a>
  );
}

function Body({ mf }: { mf: Manifest }) {
  const noise = mf.noise as unknown as Noise;
  const spatial = mf.spatial as unknown as Spatial | undefined;
  const backtest = (mf.forecast as unknown as { backtest?: Backtest } | undefined)?.backtest;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  const outliers = spatial
    ? (spatial.class_counts.LH ?? 0) + (spatial.class_counts.HL ?? 0)
    : null;

  const cov = mf.coverage
    ? {
        both: mf.coverage.both ?? 0,
        oneOnly: (mf.coverage.redfin_only ?? 0) + (mf.coverage.zhvi_only ?? 0),
        none: mf.coverage.no_data ?? 0,
        total: (mf.coverage.both ?? 0) + (mf.coverage.redfin_only ?? 0)
             + (mf.coverage.zhvi_only ?? 0) + (mf.coverage.no_data ?? 0),
      }
    : null;

  return (
    <>
      <h1 className="text-2xl font-bold mb-2 text-foreground">Methodology</h1>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
        This document describes how the values shown on the map are produced,
        how precise they are, and what they cannot be used for. Every figure is
        read from the release that built the current map rather than transcribed,
        so this page cannot describe a release other than the one on screen.
      </p>

      <nav aria-label="Contents" className="mb-10 rounded-md border border-border bg-card px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Contents
        </p>
        <ol className="space-y-1">
          {SECTIONS.map(([n, title]) => (
            <li key={n} className="text-sm">
              <a href={`#s${n}`} className="text-foreground/80 hover:text-foreground hover:underline">
                <span className="tabular-nums text-muted-foreground mr-2">{n}</span>
                {title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* ---------------------------------------------------------------- 1 */}
      <Section n="1" title="Sources and reference periods">
        <p>
          The map draws on two sources. Redfin supplies transaction statistics
          (sale prices, sale counts, listings and days on market) for a rolling
          three-month window, currently {mf.redfin.period_begin} to{" "}
          {mf.redfin.period_end}. Zillow supplies the Home Value Index (ZHVI), a
          modelled estimate of the value of a typical home, for the calendar month
          ending {mf.zhvi.period_end}.
        </p>
        <p>
          The two are on different clocks and are not interchangeable. A Redfin
          figure describes homes that actually sold in a three-month period. A ZHVI
          figure describes what a typical home in the area is estimated to be worth,
          whether or not it sold. Where the panel shows both, it names the source.
        </p>
        <p>
          Geography is the ZIP Code Tabulation Area (ZCTA), the U.S. Census
          Bureau's areal approximation of a postal ZIP code. It is not the ZIP code
          itself; see section 7.
        </p>
        <Detail>
          <p>
            The Redfin window is calendar-aligned and therefore runs 89 to 92 days
            depending on the months it spans. No single day count describes it and
            none is published. Consecutive windows overlap by two thirds, which is
            why Redfin publishes no month-over-month change at ZIP level and why
            this site does not compute one: it would be dominated by the overlap
            and by seasonality, neither of which is a market movement.
          </p>
          <p>
            ZHVI is the smoothed, seasonally adjusted series, on true calendar
            months, so its month-over-month change is the quantity that name
            implies.
          </p>
          <p>
            Every year-over-year figure on this site is recomputed from published
            levels at a twelve-month lag, in each metric's own unit: percent for
            prices and counts, percentage points for shares, and whole days or
            months for days-on-market and months-of-supply. Redfin publishes the
            last two as a difference multiplied by 100 under a percent label, so
            recomputing means those columns are never read.
          </p>
        </Detail>
      </Section>

      {/* ---------------------------------------------------------------- 2 */}
      <Section n="2" title="Classification of values into colours">
        <p>
          The map uses {mf.classes} colours. Each metric has {mf.classes - 1}{" "}
          boundary values that assign a ZIP to one of them, recomputed every
          release and published alongside the data. The legend shows the
          boundaries in use.
        </p>
        <p>
          Boundaries are chosen per metric family rather than uniformly. Prices are
          approximately log-normal, so they are cut at equal intervals on a
          logarithmic scale, which preserves the ratio between classes. Counts are
          cut at quantiles, because rank is what a reader compares. A share of
          sales is cut at equal intervals over its real zero-to-one-hundred domain;
          the average sale-to-list ratio, which is the one series that genuinely
          pivots at 100%, keeps a grid anchored there. Year-over-year change uses a
          diverging scale symmetric about zero, with a boundary falling exactly on
          zero so that no colour means &ldquo;no change&rdquo; ambiguously.
        </p>
        <p>
          Which ZIPs are allowed to <em>set</em> the boundaries is not the same
          question as which ZIPs are <em>assigned</em> a colour. Every ZIP with a
          value is assigned one. For metrics that are sample estimates, only ZIPs
          with enough transactions to be precise contribute to the boundaries, so
          that a median computed from four sales cannot move the national scale.
          For metrics that are exact counts there is no sampling error to guard
          against, and every reporting ZIP contributes.
        </p>
        <Detail>
          <p>
            The class count is measured rather than chosen. The ramp is resampled
            from a twelve-colour source at equal arc length in CIELAB, and it has a
            fixed amount of contrast to spend: about 84 units of perceptual
            distance, bounded by how far lightness can travel between the palest
            and darkest usable fill. More classes divide the same budget into
            thinner slices.
          </p>
          <p>
            So the build does not ask whether adjacent colours differ. It measures
            how many classes apart two ZIPs must be before every reader, including
            all three types of colour-vision deficiency, can see that they differ,
            and it rejects any class count where that distance is a larger share of
            the range than the seven-class ramp gave. At fourteen classes it is two
            classes, or 14.3% of the range, which is the same guarantee seven
            classes gave at one class apart. A reader with colour-vision deficiency
            resolves about seven bands, as before; everyone else resolves fourteen.
            Fifteen classes needs three, and is rejected. The ramp is also rejected
            if its lightness is not monotone, so it survives greyscale printing.
          </p>
          <p>
            Anchoring matters for the logarithmic scales. Equal classes spread over
            the observed minimum to maximum place most ZIPs in two colours, because
            a single very low and a single very high sale set the range. The
            anchors are the 1st and 99th percentiles; values outside them clamp to
            the end classes, so no ZIP is dropped.
          </p>
          <p>
            The diverging bound for year-over-year change is fixed rather than
            recomputed, and the two cases differ for opposite reasons. Price levels
            drift slowly, so a recomputed scale continues to fit them. Year-over-year
            change swings between regimes; a recomputed scale would render a boom
            and a flat year equally dramatic, which erases the difference that
            showing change is for. The bound is stated on the legend, so a clamped
            scale is not a hidden one.
          </p>
          <p>
            Restricting the boundaries for sample estimates has a measurable
            selection effect, since ZIPs with few transactions are cheaper on
            average. It is reported in the release manifest and is the reason the
            legend names the population the scale was cut over.
          </p>
        </Detail>
      </Section>

      {/* ---------------------------------------------------------------- 3 */}
      <Section n="3" title="Precision of the estimates">
        <p>
          A median sale price computed from four sales and one computed from four
          hundred are not equally reliable, and treating them as though they were
          is the most common defect in maps of this kind. Each ZIP therefore
          carries an estimated margin of error alongside its median, shown when
          you hover a ZIP or open its detail panel.
        </p>
        <p>
          The margin narrows as the number of sales grows, in proportion to the
          square root of that number. On this release, a relative margin of{" "}
          {(noise.rankable_rse * 100).toFixed(0)}% corresponds to about{" "}
          {noise.rankable_n_implied} sales.{" "}
          {noise.rankable_zips.toLocaleString()} of{" "}
          {noise.reporting_zips.toLocaleString()} reporting ZIPs reach that
          precision.
        </p>
        <p>
          That threshold decides two things, so it is stated once: which ZIPs may
          set the colour boundaries for a sample estimate (section 2), and which
          are eligible for the outlier analysis (section 5).
        </p>
        <Table
          n="1"
          caption="Precision classes. The cut is on relative margin of error; the sales column is what that implies at this release's scale constant and moves when the constant moves."
          head={["Class", "Relative margin of error", "Sales implied", "ZIPs"]}
          rows={[
            ["High", "under 4%", `${noise.tier_n_implied[2]}+`, noise.tiers["3"]?.toLocaleString() ?? "n/a"],
            ["Good", "4 to 6%", `${noise.tier_n_implied[1]}+`, noise.tiers["2"]?.toLocaleString() ?? "n/a"],
            ["Fair", "6 to 10%", `${noise.tier_n_implied[0]}+`, noise.tiers["1"]?.toLocaleString() ?? "n/a"],
            ["Low", "10% or more", `under ${noise.tier_n_implied[0]}`, noise.tiers["0"]?.toLocaleString() ?? "n/a"],
          ]}
        />
        <p>
          Precision is <strong>not</strong> encoded in the fill colour. It was,
          until the distortion was measured. Dimming the low-precision ZIPs moved
          their apparent lightness by up to four class steps on a scale whose
          meaning <em>is</em> lightness, and it fell on rural ZIPs, which the same
          data shows to be genuinely cheaper. Both errors ran the same direction.
          Precision is now reported as a number, where a number can be read.
        </p>
        <Detail>
          <p>
            The standard error of a sample median is <code>K / sqrt(n)</code> in
            logarithms, where <code>n</code> is the number of sales and{" "}
            <code>K</code> is a scale constant equal to{" "}
            <code>1.2533 × sd(log x)</code>. <code>K</code> is fitted from the data
            rather than assumed, by differencing each period against the average of
            the periods either side of it: local price trend cancels in that
            difference and the residual is sampling variation. The fitted value on
            this release is <strong>K = {noise.K}</strong> for median sale price.
          </p>
          <p>
            The fit uses a lag of {noise.K_lag_used} periods. Redfin's ZIP window
            is a rolling three months, so consecutive rows share two thirds of
            their transactions and their errors are correlated; the estimator
            assumes independence and at shorter lags recovers only a fraction of
            the true constant. Lag {noise.K_lag_used} is the first with no shared
            transactions. Beyond it the assumption that prices move locally in a
            straight line begins to degrade.
          </p>
          <Table
            n="2"
            caption="Fitted scale constant K by lag, in periods. A constant that plateaus is the evidence the fit measures sampling noise rather than price trend."
            head={["Lag", ...noise.K_lag.map((_, i) => String(i + 1))]}
            rows={[["K", ...noise.K_lag.map((k) => k.toFixed(4))]]}
          />
          <p>
            K at lag {noise.K_lag_used + 1} is {noise.plateau_ratio.toFixed(3)}{" "}
            times the shipped value. A constant that kept climbing with lag would
            indicate the fit was capturing trend.
          </p>
          <p>
            Refitting K separately within sample-size buckets tests the assumed
            functional form: if <code>1/sqrt(n)</code> holds, K should be roughly
            flat across them.
          </p>
          <Table
            n="3"
            caption="Scale constant K refitted within sample-size buckets. Thin buckets carry the highest values, so a single pooled constant understates the margin of error for the ZIPs that need it widest. A per-quartile or per-metro constant is the first refinement."
            head={["Sales", ...Object.keys(noise.K_by_sample_size)]}
            rows={[["K", ...Object.values(noise.K_by_sample_size).map((v) => v?.toFixed(4) ?? "n/a")]]}
          />
          <p>
            Each statistic is fitted separately. The dispersion of log
            days-on-market has no relationship to the dispersion of log price, so
            reusing one constant would be wrong by the ratios below.
          </p>
          <Table
            n="4"
            caption="Fitted scale constant by series."
            head={["Series", "K"]}
            rows={[
              ["Median sale price", noise.K.toFixed(4)],
              ...Object.entries(noise.per_metric ?? {}).map(([m, v]) => [m, v.K.toFixed(4)]),
            ]}
          />
        </Detail>
      </Section>

      {/* ---------------------------------------------------------------- 4 */}
      {backtest && (
        <Section n="4" title="Twelve-month forecast">
          <p>
            The detail panel shows a projection of the Zillow index twelve months
            ahead, with a shaded band around it. The line is the central estimate.
            The band is the range that historically contained the outcome as often
            as its label claims. It projects the index, not sale prices, and not
            any individual property.
          </p>
          <p>
            The model is an autoregression on monthly growth in the logarithm of
            the index, equivalent to a damped local trend. It was tested by
            refitting it at {backtest.origins.total} historical points and comparing
            its projections against what actually happened.
          </p>
          <p>
            The band's width is calibrated from those historical errors rather than
            assumed. Table 5 shows why that matters: the conventional construction,
            which scales the one-step error by the square root of the horizon, is
            correct for a random walk and is not correct here.
          </p>
          <Table
            n="5"
            caption={`Share of outcomes falling inside a nominal 80% band, by construction method and horizon in months, over ${backtest.origins.evaluation} evaluation origins. A well-calibrated band reads 80%.`}
            head={["Method", ...H.map((h) => `h=${h}`)]}
            rows={[
              ["Random walk, sigma × sqrt(h)", ...H.map((h) => pct(backtest.coverage.random_walk_sqrt_h[h]))],
              ["Autoregression, closed form", ...H.map((h) => pct(backtest.coverage.ar1_closed_form[h]))],
              ["Empirical quantiles (published)", ...H.map((h) => pct(backtest.coverage.empirical_quantiles[h]))],
            ]}
          />
          <Table
            n="6"
            caption="Forecast accuracy against a naive benchmark that carries the last observed value forward. Mean absolute error is in logarithms, multiplied by 100. A scaled error below 1.0 indicates the model beats the benchmark."
            head={["Measure", ...H.map((h) => `h=${h}`)]}
            rows={[
              ["Model, mean abs. log error ×100", ...H.map((h) => backtest.mae_log_x100[h])],
              ["Naive benchmark", ...H.map((h) => backtest.naive_mae_log_x100[h])],
              ["Mean absolute scaled error", ...H.map((h) => backtest.mase[h])],
            ]}
          />
          <p className="text-xs italic text-muted-foreground">
            These are statistical extrapolations of a third-party index with
            measured error bands. They are not investment advice.
          </p>
          <Detail>
            <p>
              An autoregression on growth is ARIMA(1,1,0) with a constant, and
              stating that equivalence is what makes the closed form usable: it
              runs in microseconds per ZIP where a general implementation takes
              milliseconds, over {backtest.eligible_zips.toLocaleString()} ZIPs.
            </p>
            <p>
              Most of the gap in Table 5 comes from using a random-walk variance
              for a model that is not a random walk. Empirical calibration closes
              the remainder, which is non-normality of the residuals.
            </p>
            <p>
              The {backtest.origins.total} origins are worth approximately{" "}
              {backtest.origins.effective_independent} independent ones. Origins
              are quarterly and the longest horizon is twelve months, so the
              evaluation windows overlap by nine. Quoting the nominal count would
              overstate the evidence roughly fourfold.
            </p>
            <p>
              The headline runs over the{" "}
              {backtest.eligible_zips.toLocaleString()} ZIPs with at least five
              years of history rather than the{" "}
              {backtest.complete_history_zips.toLocaleString()} with complete
              history. Complete history is a survivorship filter that selects
              large, established, continuously transacting markets, so reporting
              it as the headline would flatter the model.
            </p>
            <p>
              Zillow revises the index retroactively across its whole history
              between releases, so what the backtest observes at each origin is not
              what was observable at the time. The errors above are therefore
              optimistic by an unknown amount. Each monthly vintage is archived
              from this release onward, which will make a genuine point-in-time
              evaluation possible.
            </p>
          </Detail>
        </Section>
      )}

      {/* ---------------------------------------------------------------- 5 */}
      {spatial && (
        <Section n="5" title="Price outliers">
          <p>
            House prices are strongly geographically clustered: expensive ZIPs sit
            next to expensive ZIPs almost everywhere. The map already shows that.
            What it cannot show is the exception: a ZIP whose price disagrees
            with the ZIPs immediately around it.
          </p>
          <p>
            The optional overlay marks those exceptions and only those. On this
            release there are {outliers?.toLocaleString()} of them out of{" "}
            {spatial.n.toLocaleString()} eligible ZIPs: {spatial.class_counts.LH}{" "}
            that are cheap for their surroundings and {spatial.class_counts.HL}{" "}
            that are expensive for theirs.
          </p>
          <p>
            Only ZIPs that reach the precision threshold in section 3 are eligible.
            Below it, sampling variation alone will push a ZIP's median away from
            its neighbourhood, which is indistinguishable from being an outlier.
          </p>
          <Table
            n="7"
            caption="Local association classes and the median number of sales in each. Under the eligibility restriction the classes no longer separate by sample size, which is what makes the surviving outliers attributable to geography rather than to noise."
            head={["Class", ...Object.keys(spatial.class_counts)]}
            rows={[
              ["ZIPs", ...Object.values(spatial.class_counts).map((v) => v.toLocaleString())],
              ["Median sales", ...Object.keys(spatial.class_counts).map(
                (k) => spatial.lisa_median_n_by_class[k] ?? "n/a")],
            ]}
          />
          <Detail>
            <p>
              The statistic is the local Moran's I, computed over the{" "}
              {spatial.k_shipped} nearest neighbours among the{" "}
              {spatial.n.toLocaleString()} eligible ZIPs. The median distance to
              the {spatial.k_shipped}th neighbour is{" "}
              {spatial.median_8th_neighbour_km} km.
            </p>
            <p>
              Eligibility rebuilds the neighbour graph rather than filtering rows
              from a graph built over everything, because the nearest neighbours
              among eligible ZIPs are considerably further apart than among all of
              them. No figure computed without the restriction carries over.
            </p>
            <p>
              Run without the restriction, the two outlier classes had a handful
              of sales each while the cluster classes had dozens. That is the
              signature of sampling noise producing apparent outliers: a small
              sample pushed away from its neighbourhood mean is the definition of
              one.
            </p>
            <p>
              Global Moran's I depends on the number of neighbours counted, so a
              single value without its weighting is not interpretable.
            </p>
            <Table
              n="8"
              caption="Global Moran's I for median sale price, by neighbour count."
              head={["Neighbours", ...Object.keys(spatial.moran_I_by_k)]}
              rows={[["Moran's I", ...Object.values(spatial.moran_I_by_k)]]}
            />
            <p>
              Nearest-neighbour weights are asymmetric, which invalidates the
              closed-form variance, so all inference is by permutation:{" "}
              {spatial.permutations.toLocaleString()} conditional permutations with
              Benjamini-Hochberg false-discovery control at q ={" "}
              {spatial.fdr_q}. {spatial.bh_significant.toLocaleString()} ZIPs clear
              it.
            </p>
            <p>
              Family-wise error control by the Bonferroni correction is not merely
              conservative here but unattainable. The required threshold is{" "}
              {spatial.bonferroni_threshold.toExponential(2)}, while the smallest
              p-value obtainable from {spatial.permutations.toLocaleString()}{" "}
              permutations is {(1 / (spatial.permutations + 1)).toExponential(2)}.
              Attaining it would require approximately{" "}
              {spatial.permutations_for_bonferroni.toLocaleString()} permutations.
            </p>
            <p>
              Two qualifications. This is descriptive clustering with a permutation
              screen, not a hypothesis test: the null being tested is complete
              spatial randomness, which the global statistic rejects everywhere.
              And Benjamini-Hochberg under spatial dependence is valid under
              positive regression dependency, which is an assumption rather than an
              established fact.
            </p>
          </Detail>
        </Section>
      )}

      {/* ---------------------------------------------------------------- 6 */}
      <Section n="6" title="Series redefined by the source in May 2026">
        <p>
          Redfin rebuilt its data pipeline in May 2026 and unified two previously
          separate trackers. Most series were unaffected. Two were redefined, and
          comparing them against values published before June 2026 compares
          different quantities.
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Share sold above list price</strong> is now measured against the
            original list price rather than the most recent one. A home listed at
            $500,000, reduced to $450,000 and sold at $460,000 counts as below list
            under the new definition and above list under the old one. The share
            moves for reasons unrelated to market conditions.
          </li>
          <li>
            <strong>Median new listing price</strong> narrowed to newly listed homes
            only, where it previously covered all active inventory. New listings
            differ in composition from the standing stock, and the rebuilt series
            runs approximately $8,000 below the old one.
          </li>
        </ul>
        <p>
          This is an upstream definition change, not a data error and not a market
          movement. Any time series crossing June 2026 requires a break marker for
          these two rather than a continuous line.
        </p>
      </Section>

      {/* ---------------------------------------------------------------- 7 */}
      <Section n="7" title="Limitations">
        <p>The following are properties of the data and the method, not defects to be fixed.</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>This is not a valuation of any individual property.</strong> Every
            figure describes an area. Condition, size, lot, age and street are not
            controlled for, so two homes in the same ZIP can differ from its median
            by more than ZIPs differ from each other.
          </li>
          <li>
            <strong>A ZCTA is not a ZIP code.</strong> Postal ZIP codes are delivery
            routes, not areas; the Census Bureau's tabulation areas approximate them
            from block-level assignments. Some ZIP codes, such as post-office
            boxes and single-building codes, have no tabulation area and cannot be
            drawn.
          </li>
          <li>
            <strong>A ZIP is not a neighbourhood.</strong> Boundaries follow postal
            logistics, not housing markets. A single ZIP frequently spans areas that
            no local buyer would treat as one market.
          </li>
          <li>
            <strong>The Redfin window is three months, not one.</strong> A change
            between consecutive published windows reflects one month of new
            transactions against two months carried over.
          </li>
          <li>
            <strong>Coverage is not universal.</strong>
            {cov ? (
              <> Of the {cov.total.toLocaleString()} tabulation areas drawn,{" "}
                {cov.both.toLocaleString()} are reported by both sources,{" "}
                {cov.oneOnly.toLocaleString()} by only one, and{" "}
                {cov.none.toLocaleString()} by neither.</>
            ) : (
              <> Some areas are reported by only one source and some by neither.</>
            )}{" "}
            Areas reported by neither are drawn in grey, which is not the same as a
            value of zero.
          </li>
          <li>
            <strong>Sale prices are not quality-adjusted.</strong> A change in the
            median can reflect a change in which homes sold rather than a change in
            what homes are worth. The Zillow index attempts to control for this;
            Redfin's median does not.
          </li>
          <li>
            <strong>The precision estimate covers sampling only.</strong> It does not
            cover reporting lags, coverage differences between metropolitan areas, or
            revisions by either source.
          </li>
        </ul>
      </Section>

      {/* ---------------------------------------------------------------- 8 */}
      <Section n="8" title="Notation and glossary">
        <dl className="mt-1">
          <Term name="n">Number of closed sales in a ZIP over the reference window.</Term>
          <Term name="K">
            Scale constant in the standard error of a median, equal to{" "}
            <code>1.2533 × sd(log x)</code>. Fitted per series, per release.
          </Term>
          <Term name="RSE">
            Relative standard error. The estimated margin of error expressed as a
            share of the estimate.
          </Term>
          <Term name="h">Forecast horizon, in months.</Term>
          <Term name="MASE">
            Mean absolute scaled error. Forecast error divided by the error of a
            benchmark that carries the last value forward. Below 1.0 beats it.
          </Term>
          <Term name="ZHVI">
            Zillow Home Value Index. A modelled estimate of the value of a typical
            home in an area, published monthly, smoothed and seasonally adjusted.
          </Term>
          <Term name="ZCTA">
            ZIP Code Tabulation Area. The Census Bureau's areal approximation of a
            postal ZIP code.
          </Term>
          <Term name="Moran's I">
            A measure of whether nearby areas hold similar values. Positive means
            similar values cluster together.
          </Term>
          <Term name="FDR">
            False discovery rate. The expected share of flagged results that are
            false positives, controlled here at q = {spatial?.fdr_q ?? "n/a"}.
          </Term>
          <Term name="YoY">
            Year over year. Change against the same reference period twelve months
            earlier, recomputed from published levels.
          </Term>
        </dl>
      </Section>

      <p className="mt-12 pt-4 border-t border-border text-xs text-muted-foreground">
        Release generated {mf.generated_utc}. Figures on this page are read from
        that release's manifest at page load.
      </p>

      {/* This is a long document. A reader who has reached the end of it should
          not have to scroll back up to find the way out. */}
      <BackToMap className="mt-6" />
    </>
  );
}
