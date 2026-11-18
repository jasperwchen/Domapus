# Why the map has 14 colours, and not 7 or 15

Draft. Figures from `docs/CHANGES.md` (2026-09-11 entry) and
`scripts/palette/derive_ramp.mjs`.

## Seven was a legend rule

Domapus colours each ZIP code by which of N classes its value falls in. It used to use 7.
The justification was a familiar rule of thumb: a sequential colour ramp supports 5 to 9 steps
before neighbours stop being distinguishable.

That rule is about a legend you read swatch by swatch. A choropleth is read as a gradient,
and at 7 classes it threw away a lot. One price class spanned a factor of 1.49, so around
$400k two ZIPs $190k apart painted the same colour.

## What actually limits the count

The real limit is colour-vision deficiency. Simulate how the ramp looks to someone with
protanopia, deuteranopia or tritanopia (Machado 2009, applied in linear RGB, because applying
it to gamma-encoded values overstates the contrast that remains), and measure the ramp's total
length in CIELAB colour difference (dE76).

Under tritanopia it comes to about 84 dE76, and no choice of hues buys more. Tritanopia
collapses the yellow-blue axis this ramp's colour lives on, so what remains is lightness, and
lightness can only travel so far between the palest fill that still reads against the
basemap and the darkest.

A fixed length shared among more classes makes each step smaller. So asking "can a
colour-blind reader tell adjacent swatches apart" just caps the count again. The better
question is how many classes apart two ZIPs must be before every reader can tell them apart.
Call that the separable span. Divide it by the class count and you get the share of the range
a reader is guaranteed to resolve.

| Classes | Separable span | Guaranteed visible | Verdict |
|---|---|---|---|
| 7 | 1 | 14.3% | what shipped |
| 13 | 2 | 15.4% | rejected |
| 14 | 2 | 14.3% | taken |
| 15 | 3 | 20.0% | rejected |

The rule is: never be worse for a colour-blind reader than 7 classes was. 14 is the largest
count that meets it. A colour-blind reader still resolves about 7 bands, exactly as before;
normal vision now resolves 14, at 13.79 dE76 between neighbours, far above the roughly 2.3
that people can perceive.

15 was asked for first. Measuring it is what turned it down.

## A second, independent ceiling

The paint table stores the class in four bits, as class plus one, with zero meaning no data.
Four bits hold 0 to 15, so the largest class is 14. A 16th class would encode as 0x10,
which reads back as reliability tier 1 with no class at all. The pipeline raises on that
rather than trusting the palette script to have caught it first.

## What changed on the map

With 14 classes the biggest single class shrank on every metric (2026-07 release):

| Metric | Biggest class before | After |
|---|---|---|
| Share of sales above list | 65.6% | 33.8% |
| Home value, year-over-year | 57% | 31.6% |
| Home value | | 14.1% |
| Median sale price | | 13.5% |

The share-above-list fix also needed a different scheme. Its old grid was anchored at 100%,
which is right for a sale-to-list ratio and wrong for a share that approaches 100% from
below; the grid never reached the data.

An even class count also put a boundary exactly on zero for the year-over-year maps. Under
7 classes a neutral band from -4% to +4% held 57% of ZIPs, so the largest block on the map was
the one that said nothing. Now every cool colour is a decline and every warm one a rise.

## The legend tells the truth

The legend is 14 hard bands, not a smooth gradient. At 14 it reads as a ramp anyway, and
every pixel in it is a colour some ZIP is actually painted. A gradient would have put colours
in the key that the map can never produce. The map, the legend and the PNG/PDF export all
import the ramp from one generated file; they used to carry three lists that disagreed.
