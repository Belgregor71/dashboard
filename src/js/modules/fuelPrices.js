const REFRESH_MS = 2 * 60 * 60 * 1000;

const BRANDS = [
  { match: /\bbp\b/i,               label: "BP",   bg: "#007A33", fg: "#fff"    },
  { match: /shell/i,                 label: "SHL",  bg: "#DD1D21", fg: "#FBCE07" },
  { match: /ampol/i,                 label: "AMP",  bg: "#E31837", fg: "#fff"    },
  { match: /caltex/i,                label: "CAL",  bg: "#E31837", fg: "#fff"    },
  { match: /7.?eleven|7-?11/i,       label: "7/11", bg: "#F04E23", fg: "#fff"    },
  { match: /u.?go/i,                 label: "UGO",  bg: "#0B6CBE", fg: "#fff"    },
  { match: /united/i,                label: "UNI",  bg: "#0B6CBE", fg: "#fff"    },
  { match: /coles/i,                 label: "COL",  bg: "#E01A22", fg: "#fff"    },
  { match: /woolworths|everyday/i,   label: "WOW",  bg: "#00833E", fg: "#fff"    },
  { match: /liberty/i,               label: "LIB",  bg: "#003087", fg: "#fff"    },
  { match: /puma/i,                  label: "PUMA", bg: "#C8102E", fg: "#fff"    },
  { match: /metro/i,                 label: "MTR",  bg: "#1B4F8A", fg: "#fff"    },
  { match: /pacific/i,               label: "PAC",  bg: "#1E5FAD", fg: "#fff"    },
  { match: /pearl/i,                 label: "PRL",  bg: "#5B9BD5", fg: "#fff"    },
  { match: /solo/i,                  label: "SOLO", bg: "#E67E22", fg: "#fff"    },
  { match: /mega/i,                  label: "MEGA", bg: "#8E44AD", fg: "#fff"    },
];

function getBrand(name) {
  for (const b of BRANDS) {
    if (b.match.test(name)) return b;
  }
  const abbr = name.trim().split(/\s+/)[0].slice(0, 4).toUpperCase();
  return { label: abbr, bg: "rgba(255,255,255,0.12)", fg: "#fff" };
}

// Strip brand name from the front of the station name for cleaner display
function stationLabel(name) {
  return name
    .replace(/^(bp|shell|ampol|caltex|7-eleven|u-go|united|coles\s*express|woolworths|liberty|puma|metro|pacific petroleum|pearl energy|solo|mega fuels)\s*/i, "")
    .trim() || name;
}

function renderList(sites) {
  const list = document.getElementById("fuel-panel-list");
  if (!list) return;
  list.innerHTML = sites.map(s => {
    const brand    = getBrand(s.name);
    const label    = stationLabel(s.name);
    const [w, d]   = s.price.toFixed(1).split(".");
    return `
      <div class="fuel-station">
        <div class="fuel-badge" style="background:${brand.bg};color:${brand.fg}">${brand.label}</div>
        <div class="fuel-details">
          <div class="fuel-station-name">${label}</div>
          <div class="fuel-dist">${s.distanceKm} km away</div>
        </div>
        <div class="fuel-price-line">
          <span class="fuel-price">${w}.${d}</span><span class="fuel-cents">¢</span>
        </div>
      </div>`;
  }).join("");
}

export function initFuelPrices() {
  async function refresh() {
    try {
      const r = await fetch("/api/fuel");
      if (!r.ok) return;
      const data = await r.json();
      if (data.configured === false) return;
      const sites = data.sites ?? [];
      if (sites.length) renderList(sites);
    } catch { /* non-fatal */ }
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
}
