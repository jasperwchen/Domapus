<p align="center">
    <img src="public/Banner.svg" width="400" alt="Domapus Banner">
</p>

<p align="center">
   <a href="https://jasperwchen.github.io/Domapus/" target="_blank" rel="noopener noreferrer"> 
    <img src="https://img.shields.io/badge/Live_Website-Open-1E40AF?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Live Website">
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-Apache--2.0-blue" alt="License">
<img src="https://img.shields.io/github/stars/jasperwchen/Domapus?style=flat&labelColor=%232F3742&color=%23E3B341&link=https%3A%2F%2Fgithub.com%2Fjasperwchen%2FDomapus%2Fstargazers" alt="Stars">

</p>

**Domapus** is a website that visualizes U.S. housing market data at the ZIP-code level.  

---

## Features

### Main Dashboard
<p align="center">
Visualize median price, inventory, and sales trends nationwide. Hover over a ZIP code to show value.
<img src="public/readme/dashboard.png" width="80%" alt="Main Dashboard">
</p>
<br>

### Granular ZIP Details
<p align="center">
Click on a ZIP code to access detailed market data.
<img src="public/readme/detail.png" width="80%" alt="Sidebar Details">
</p>
<br>

### Comparative Analysis
<p align="center">
Compare two ZIP codes side-by-side to evaluate relative market performance across all available metrics.
<img src="public/readme/compare.png" width="80%" alt="Comparison Mode">
</p>
<br>

### Export
<p align="center">
Generate report-ready maps with customizations.
<img src="public/readme/export.png" width="80%" alt="Export Feature">
</p>

---

## Quick Start

1. **Clone the repository**

   ```bash
   git clone https://github.com/jasperwchen/Domapus.git
   cd Domapus
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start the development server**

   ```bash
   npm run dev
   ```

4. **Open your browser**
   Navigate to `http://localhost:3677/Domapus/`

### Build for Production

```bash
npm run build && npm run preview
```

---

## Tech Stack
**Frontend:** React 18, TypeScript, Vite

**UI:** Tailwind CSS, Radix UI, Lucide React, Shadcn

**Map:** MapLibre GL JS, Pmtiles, Bbox, RBush

**Export:** Canvas 2D, jsPDF

**Deployment:** Github Pages

---

## Project Structure

See [tree.txt](tree.txt) — regenerated on each commit by `npm run tree`.

---

## Metrics Overview

| Metric | Choropleth Support |
| :--- | :---: |
| **Zillow Housing Value Index** | Yes |
| **Median Sale Price** | Yes |
| **Median Price per Sq Ft** | Yes |
| **Median Days on Market** | Yes |
| **Sale-to-List Ratio** | Yes |
| **Median List Price** | Yes |
| **Homes Sold** | Yes |
| **Pending Sales** | Yes |
| **New Listings** | Yes |
| **Inventory** | Yes |
| **% Sold Above List** | Yes |
| **% Off Market in 2 Weeks** | Yes |

---

## Data Sources

-  [Redfin Data Center](https://www.redfin.com/news/data-center/)
-  [Zillow Research](https://www.zillow.com/research/data/)

---

## Limitations

1.  **Data Coverage:** Redfin tracks only ZIP codes with active market. Rural ZIP codes with low transaction volume may report "N/A".
2.  **Update Frequency:** Data is aggregated on a monthly basis. This is not a real-time MLS feed.

---

## Contributing

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes with proper TypeScript types
4. Test your changes: `npm run build && npm run preview`
5. Run linting: `npm run lint`
6. Enable the repo hooks once so `tree.txt` stays current: `git config core.hooksPath .githooks`
7. Commit your changes: `git commit -m 'Add amazing feature'`
8. Push to your branch: `git push origin feature/amazing-feature`
9. Open a Pull Request

---

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE.md) file for details.

---

## Issues

- **Issues**: Report bugs and request features via [GitHub Issues](https://github.com/jasperwchen/Domapus/issues)
- **Email**: You can contact the maintainer at [jasperc.wk@gmail.com](mailto:jasperc.wk@gmail.com)

---

## Support the Project

If you find Domapus useful, consider supporting its development:

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-orange?style=flat&logo=buy-me-a-coffee)](https://buymeacoffee.com/JasperC)

---

<div align="center">
   <strong>Built by <a href="https://github.com/jasperwchen">Jasper Chen</a></strong>
    <br><small>Distributed under the <a href="https://github.com/jasperwchen/Domapus?tab=Apache-2.0-1-ov-file">Apache License 2.0</a></small>
</div>
