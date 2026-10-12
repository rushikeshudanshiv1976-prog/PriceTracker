
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const RETAILERS = [
  {
    name: "Amazon",
    subtitle: "Electronics, fashion & more",
    initials: "a",
    className: "amazon",
    url: "https://www.amazon.in/",
  },
  {
    name: "Flipkart",
    subtitle: "Mobiles, laptops & appliances",
    initials: "F",
    className: "flipkart",
    url: "https://www.flipkart.com/",
  },
  {
    name: "Croma",
    subtitle: "Technology & electronics",
    initials: "C",
    className: "croma",
    url: "https://www.croma.com/",
  },
  {
    name: "Reliance Digital",
    subtitle: "Electronics & gadgets",
    initials: "R",
    className: "reliance",
    url: "https://www.reliancedigital.in/",
  },
];

const PLACEHOLDER_IMAGE =
  "https://placehold.co/600x400/171725/c4ff4d?text=Product";

function money(value, currency = "INR") {
  const amount = Number(value);

  if (
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return "Price unavailable";
  }

  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `₹${amount.toLocaleString("en-IN")}`;
  }
}

function getErrorMessage(error) {
  const detail = error?.response?.data?.detail;

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg).join(", ");
  }

  return (
    error?.response?.data?.message ||
    error?.message ||
    "Something went wrong."
  );
}

function getProductImage(product) {
  return product?.image_url || product?.image || PLACEHOLDER_IMAGE;
}

function getRetailerName(product) {
  return (
    product?.retailer ||
    product?.source ||
    "Retailer not specified"
  );
}

function getProductPrice(product) {
  return product?.price ?? product?.current_price ?? null;
}

function isExternalProduct(product) {
  return product?.source === "Google Shopping via SerpApi";
}

function getPriceLabel(product) {
  if (isExternalProduct(product)) {
    return product.price_status === "provider_reported"
      ? "PROVIDER-REPORTED PRICE"
      : "PRICE UNAVAILABLE";
  }

  return product?.price_status === "verified"
    ? "VERIFIED PRICE"
    : "CATALOG LISTING";
}

export default function App() {
  const [page, setPage] = useState("dashboard");

  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") || "dark"
  );

  const [token, setToken] = useState(
    () => localStorage.getItem("access_token") || ""
  );

  const [user, setUser] = useState(
    () => localStorage.getItem("user_email") || ""
  );

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchMode, setSearchMode] = useState("external");
  const [watchlist, setWatchlist] = useState([]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState("login");

  const [searchLoading, setSearchLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [trackingId, setTrackingId] = useState(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const authHeaders = useCallback(() => {
    return token
      ? { Authorization: `Bearer ${token}` }
      : {};
  }, [token]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Validate the saved login when the application starts.
  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    axios
      .get(`${API}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((response) => {
        if (cancelled) return;

        const profile = response.data?.user || response.data;
        const emailAddress = profile?.email || user;

        setUser(emailAddress);
        localStorage.setItem("user_email", emailAddress);
      })
      .catch(() => {
        if (cancelled) return;

        setToken("");
        setUser("");
        localStorage.removeItem("access_token");
        localStorage.removeItem("user_email");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const loadWatchlist = useCallback(async () => {
    if (!token) {
      setWatchlist([]);
      return;
    }

    setWatchlistLoading(true);

    try {
      const response = await axios.get(
        `${API}/api/products/watchlist`,
        { headers: authHeaders() }
      );

      setWatchlist(
        Array.isArray(response.data) ? response.data : []
      );
    } catch (err) {
      setError(
        `Could not load your tracked products. ${getErrorMessage(err)}`
      );
    } finally {
      setWatchlistLoading(false);
    }
  }, [token, authHeaders]);

  useEffect(() => {
    if (token) {
      loadWatchlist();
    } else {
      setWatchlist([]);
    }
  }, [token, loadWatchlist]);

  const navigate = (nextPage) => {
    setPage(nextPage);
    setError("");
    setMessage("");
    setMobileMenuOpen(false);

    if (nextPage === "watchlist" && !token) {
      setPage("profile");
      setMessage(
        "Log in to see your personal tracked-products list."
      );
    }
  };

  // External mode calls SerpApi through the backend.
  // Catalog mode searches products already saved in PostgreSQL.
  const handleSearch = async (event) => {
    event?.preventDefault();

    const searchTerm = query.trim();

    if (searchTerm.length < 2) {
      setError("Enter at least two characters to search.");
      return;
    }

    setSearchLoading(true);
    setError("");
    setMessage("");
    setPage("search");

    try {
      if (searchMode === "external") {
        const response = await axios.get(
          `${API}/api/products/compare/external`,
          { params: { q: searchTerm, limit: 20 } }
        );

        setSearchResults(
          Array.isArray(response.data?.groups)
            ? response.data.groups
            : []
        );
      } else {
        const response = await axios.get(
          `${API}/api/products/search`,
          {
            params: {
              q: searchTerm,
              limit: 50,
            },
          }
        );

        setSearchResults(
          Array.isArray(response.data) ? response.data : []
        );
      }
    } catch (err) {
      setSearchResults([]);
      setError(`Search failed. ${getErrorMessage(err)}`);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleAuth = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setAuthLoading(true);

    const endpoint =
      authMode === "register"
        ? "/api/auth/register"
        : "/api/auth/login";

    try {
      const response = await axios.post(`${API}${endpoint}`, {
        email: email.trim(),
        password,
      });

      const accessToken = response.data?.access_token;
      const accountEmail =
        response.data?.user?.email ||
        response.data?.email ||
        email.trim();

      if (!accessToken) {
        throw new Error(
          "The server did not return an access token. Check the authentication API response."
        );
      }

      setToken(accessToken);
      setUser(accountEmail);

      localStorage.setItem("access_token", accessToken);
      localStorage.setItem("user_email", accountEmail);

      setPassword("");
      setPage("profile");

      setMessage(
        authMode === "register"
          ? "Account created successfully!"
          : "Welcome back! You are logged in."
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setToken("");
    setUser("");
    setWatchlist([]);

    localStorage.removeItem("access_token");
    localStorage.removeItem("user_email");

    setPage("dashboard");
    setMessage("You have been logged out.");
    setError("");
  };

  // Saved-catalog products have database IDs and can be tracked.
  // External search results must first be saved through a backend
  // endpoint before they can be added to the watchlist.
  const trackProduct = async (product) => {
    if (!token) {
      setPage("profile");
      setMessage("Log in first to save products to your watchlist.");
      return;
    }

    if (product?.offers && product.offers.length) {
      const cheapest = product.offers.find((offer) => Number(offer.price) > 0);
      if (!cheapest) {
        setError("This product has no usable price to track yet.");
        return;
      }
      setTrackingId(product.title);
      setError("");
      setMessage("");
      try {
        const response = await axios.post(
          `${API}/api/products/track-external`,
          {
            title: product.title,
            url: cheapest.url,
            retailer: cheapest.retailer,
            price: cheapest.price,
            image_url: cheapest.image_url || product.image_url || undefined,
          },
          { headers: authHeaders() }
        );
        setMessage(response.data?.message || "Product added to your watchlist.");
        await loadWatchlist();
      } catch (err) {
        setError(`Could not track this product. ${getErrorMessage(err)}`);
      } finally {
        setTrackingId(null);
      }
      return;
    }

    if (isExternalProduct(product)) {
      setError("Choose a product comparison card before tracking.");
      return;
    }

    if (!product?.id) {
      setError(
        "This product has no database ID and cannot be tracked yet."
      );
      return;
    }

    setTrackingId(product.id);
    setError("");
    setMessage("");

    try {
      const response = await axios.post(
        `${API}/api/products/${product.id}/track`,
        {},
        { headers: authHeaders() }
      );

      setMessage(
        response.data?.message ||
          "Product added to your watchlist."
      );

      await loadWatchlist();
    } catch (err) {
      setError(
        `Could not track this product. ${getErrorMessage(err)}`
      );
    } finally {
      setTrackingId(null);
    }
  };

  const removeTrackedProduct = async (subscriptionId) => {
    if (!token) return;

    setError("");
    setMessage("");

    try {
      await axios.delete(
        `${API}/api/products/watchlist/${subscriptionId}`,
        { headers: authHeaders() }
      );

      setWatchlist((current) =>
        current.filter(
          (item) => item.subscription_id !== subscriptionId
        )
      );

      setMessage("Product removed from your tracked list.");
    } catch (err) {
      setError(
        `Could not remove the product. ${getErrorMessage(err)}`
      );
    }
  };

  const toggleTheme = () => {
    setTheme((current) =>
      current === "dark" ? "light" : "dark"
    );
  };

  const navItems = [
    { id: "dashboard", icon: "⌂", label: "Dashboard" },
    { id: "search", icon: "⌕", label: "Search & Compare" },
    { id: "watchlist", icon: "♡", label: "Tracked Products" },
    { id: "profile", icon: "◉", label: "Profile & Settings" },
  ];

  const currentTitle =
    navItems.find((item) => item.id === page)?.label ||
    "Dashboard";

  return (
    <div className="app-container">
      <aside
        className={`sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`}
      >
        <button
          className="brand"
          onClick={() => navigate("dashboard")}
          type="button"
        >
          <span className="brand-icon">P</span>
          <span>
            price<span className="brand-accent">tracker</span>
            <small>SHOP SMARTER.</small>
          </span>
        </button>

        <div className="sidebar-label">WORKSPACE</div>

        <nav className="nav-links">
          {navItems.map((item) => (
            <button
              type="button"
              key={item.id}
              className={page === item.id ? "active" : ""}
              onClick={() => navigate(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>

              {item.id === "watchlist" &&
                watchlist.length > 0 && (
                  <span className="nav-count">
                    {watchlist.length}
                  </span>
                )}
            </button>
          ))}
        </nav>

        <div className="sidebar-promo">
          <span className="promo-spark">✳</span>
          <h3>Buy smarter.</h3>
          <p>Compare what is available before you spend.</p>
          <button
            type="button"
            onClick={() => navigate("search")}
          >
            Find a product <span>↗</span>
          </button>
        </div>

        <div className="sidebar-bottom">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            type="button"
          >
            <span>{theme === "dark" ? "☀" : "☾"}</span>
            <span>
              {theme === "dark" ? "Switch to light" : "Switch to dark"}
            </span>
            <span className="theme-state">
              {theme === "dark" ? "DARK" : "LIGHT"}
            </span>
          </button>

          <button
            className="sidebar-user"
            onClick={() => navigate("profile")}
            type="button"
          >
            <span className="avatar">
              {user ? user.charAt(0).toUpperCase() : "G"}
            </span>
            <span className="sidebar-user-copy">
              <strong>
                {user ? user.split("@")[0] : "Guest account"}
              </strong>
              <small>{user || "Log in to get started"}</small>
            </span>
            <span className="user-arrow">↗</span>
          </button>
        </div>
      </aside>

      {mobileMenuOpen && (
        <button
          className="mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="mobile-menu-button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              type="button"
              aria-label="Toggle navigation"
            >
              ☰
            </button>

            <div>
              <span className="breadcrumb">PRICE TRACKER /</span>
              <h1>{currentTitle}</h1>
            </div>
          </div>

          <form className="search-bar" onSubmit={handleSearch}>
            <span>⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search products..."
              aria-label="Search products"
            />
            <kbd>↵</kbd>
          </form>

          <div className="topbar-actions">
            <span className={`status-dot ${token ? "online" : ""}`} />
            <span className="session-label">
              {token ? "Account active" : "Guest mode"}
            </span>
            <button
              className="top-avatar"
              onClick={() => navigate("profile")}
              type="button"
              aria-label="Open profile"
            >
              {user ? user.charAt(0).toUpperCase() : "G"}
            </button>
          </div>
        </header>

        <div className="content-body">
          {message && (
            <div className="notice notice-success">
              <span>✓</span>
              <p>{message}</p>
              <button
                onClick={() => setMessage("")}
                type="button"
              >
                ×
              </button>
            </div>
          )}

          {error && (
            <div className="notice notice-error">
              <span>!</span>
              <p>{error}</p>
              <button
                onClick={() => setError("")}
                type="button"
              >
                ×
              </button>
            </div>
          )}

          {page === "dashboard" && (
            <Dashboard
              user={user}
              watchlist={watchlist}
              onNavigate={navigate}
            />
          )}

          {page === "search" && (
            <SearchPage
              query={query}
              setQuery={setQuery}
              onSearch={handleSearch}
              results={searchResults}
              loading={searchLoading}
              searchMode={searchMode}
              setSearchMode={setSearchMode}
              onTrack={trackProduct}
              trackingId={trackingId}
              onNavigate={navigate}
            />
          )}

          {page === "watchlist" && (
            <WatchlistPage
              items={watchlist}
              loading={watchlistLoading}
              onRemove={removeTrackedProduct}
              onNavigate={navigate}
              token={token}
            />
          )}

          {page === "profile" && (
            <ProfilePage
              user={user}
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              authMode={authMode}
              setAuthMode={setAuthMode}
              loading={authLoading}
              onSubmit={handleAuth}
              onLogout={handleLogout}
              onNavigate={navigate}
            />
          )}

          <footer className="app-footer">
            <span>MADE FOR SMARTER SHOPPING ✳</span>
            <span>
              PriceTracker <span className="footer-dot">●</span>{" "}
              Compare before you buy.
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function Dashboard({ user, watchlist, onNavigate }) {
  return (
    <div className="page-stack">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="live-pulse" /> YOUR SMART SHOPPING SPACE
          </span>
          <h2>
            Less scrolling.
            <br />
            <span>More saving.</span>
          </h2>
          <p>
            Find a product, compare available prices, and keep an eye
            on the things you want to buy.
          </p>
          <button
            className="btn-primary hero-button"
            onClick={() => onNavigate("search")}
            type="button"
          >
            Explore products <span>↗</span>
          </button>
          <div className="hero-footnote">
            <span>✳</span> One place for your shopping research
          </div>
        </div>

        <div className="hero-art" aria-hidden="true">
          <div className="hero-ring ring-one" />
          <div className="hero-ring ring-two" />
          <div className="hero-orb">₹</div>
          <div className="floating-tag tag-top">
            <span className="tag-icon">↗</span>
            <span>
              <small>SHOPPING MODE</small>
              <strong>ON POINT.</strong>
            </span>
          </div>
          <div className="floating-tag tag-bottom">
            <span className="tag-check">✓</span>
            <span>
              <small>YOUR NEXT PURCHASE</small>
              <strong>Make it count.</strong>
            </span>
          </div>
          <div className="hero-star star-one">✳</div>
          <div className="hero-star star-two">✦</div>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard
          icon="⌕"
          label="PRODUCT SEARCH"
          value="Explore"
          detail="Search retailer listings"
        />
        <StatCard
          icon="♡"
          label="YOUR WATCHLIST"
          value={watchlist.length}
          detail="Products you are tracking"
        />
        <StatCard
          icon="↗"
          label="RETAILER OPTIONS"
          value="04"
          detail="Retailer websites to explore"
        />
        <StatCard
          icon="◉"
          label="ACCOUNT"
          value={user ? "Ready" : "Guest"}
          detail={user ? "Your account is active" : "Log in to save products"}
        />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">THE SHOPPING LINEUP</span>
            <h2>
              Retailers to explore <span>↗</span>
            </h2>
            <p>Visit retailer websites to check their current offers.</p>
          </div>
          <span className="section-index">01 / RETAILERS</span>
        </div>

        <div className="retailer-grid">
          {RETAILERS.map((retailer, index) => (
            <a
              className="retailer-card"
              href={retailer.url}
              target="_blank"
              rel="noreferrer"
              key={retailer.name}
            >
              <div className={`retailer-mark ${retailer.className}`}>
                {retailer.initials}
              </div>
              <div className="retailer-info">
                <span className="retailer-number">0{index + 1}</span>
                <h3>{retailer.name}</h3>
                <p>{retailer.subtitle}</p>
                <span className="retailer-link">Visit website ↗</span>
              </div>
              <span className="retailer-arrow">↗</span>
            </a>
          ))}
        </div>
      </section>

      <section className="bottom-banner">
        <div className="banner-symbol">✳</div>
        <div>
          <span className="eyebrow">YOUR NEXT GOOD BUY STARTS HERE</span>
          <h2>
            {user
              ? "Ready to compare something?"
              : "Your wishlist deserves a plan."}
          </h2>
          <p>
            {user
              ? "Search products and add catalog items to your personal watchlist."
              : "Create an account to save products and build your own tracked list."}
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => onNavigate(user ? "search" : "profile")}
          type="button"
        >
          {user ? "Start comparing" : "Get started"} <span>↗</span>
        </button>
      </section>

      <p className="disclaimer">
        Retailer links open external websites. Prices and availability can change;
        verify current offers directly with the retailer.
      </p>
    </div>
  );
}

function StatCard({ icon, label, value, detail }) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span className="stat-icon">{icon}</span>
        <span className="stat-label">{label}</span>
      </div>
      <strong className="stat-value">{value}</strong>
      <span className="stat-detail">{detail}</span>
    </div>
  );
}

function SearchPage({
  query,
  setQuery,
  onSearch,
  results,
  loading,
  searchMode,
  setSearchMode,
  onTrack,
  trackingId,
  onNavigate,
}) {
  return (
    <div className="page-stack">
      <section className="page-intro">
        <span className="eyebrow">FIND YOUR NEXT BUY</span>
        <h2>
          Search. Compare. <span>Decide.</span>
        </h2>
        <p>
          Compare provider-reported retailer listings or search your saved catalog.
        </p>
      </section>

      <div className="auth-tabs">
        <button
          type="button"
          className={searchMode === "external" ? "selected" : ""}
          onClick={() => setSearchMode("external")}
        >
          Indian retailer search
        </button>
        <button
          type="button"
          className={searchMode === "catalog" ? "selected" : ""}
          onClick={() => setSearchMode("catalog")}
        >
          Saved catalog
        </button>
      </div>

      <form className="large-search" onSubmit={onSearch}>
        <span>⌕</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try Acer Nitro V RTX 4050..."
          aria-label="Product search"
        />
        <button className="btn-primary" disabled={loading} type="submit">
          {loading ? "Searching..." : "Search products"}
        </button>
      </form>

      <div className="results-heading">
        <div>
          <h3>{results.length ? "Available results" : "Your search results"}</h3>
          <p>
            {results.length
              ? `${results.length} listing${results.length === 1 ? "" : "s"} found`
              : searchMode === "external"
                ? "Search Google Shopping through the configured backend provider."
                : "Search products already stored in your catalog."}
          </p>
        </div>
        <span className="data-chip">
          {searchMode === "external" ? "EXTERNAL LISTINGS" : "CATALOG DATA"}
        </span>
      </div>

      {loading ? (
        <div className="empty-state">
          <span className="loader" /> Searching...
        </div>
      ) : results.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">⌕</div>
          <h3>Nothing to compare just yet</h3>
          <p>
            Try a different search phrase. External results depend on the
            search provider; catalog results depend on saved database records.
          </p>
          <button
            className="btn-secondary"
            onClick={() => onNavigate("dashboard")}
            type="button"
          >
            Back to dashboard
          </button>
        </div>
      ) : (
        <div className="product-grid">
          {results.map((product, index) => {
            
if (Array.isArray(product.offers)) {
  const offers = product.offers;

  // Sort priced offers from lowest to highest.
  const sortedOffers = [...offers].sort((a, b) => {
    const priceA = Number(a.price);
    const priceB = Number(b.price);
    const validA = Number.isFinite(priceA) && priceA > 0;
    const validB = Number.isFinite(priceB) && priceB > 0;

    if (validA && validB) return priceA - priceB;
    if (validA) return -1;
    if (validB) return 1;
    return 0;
  });

  const cheapest = sortedOffers.find(
    (offer) =>
      Number.isFinite(Number(offer.price)) &&
      Number(offer.price) > 0
  );

  const image =
    offers.find((offer) => offer.image_url)?.image_url ||
    product.image_url ||
    PLACEHOLDER_IMAGE;

  const pricedOffers = sortedOffers.filter(
    (offer) =>
      Number.isFinite(Number(offer.price)) &&
      Number(offer.price) > 0
  );

  const highestPrice =
    pricedOffers.length > 0
      ? Number(pricedOffers[pricedOffers.length - 1].price)
      : null;

  const savings =
    cheapest && highestPrice !== null
      ? highestPrice - Number(cheapest.price)
      : 0;

  return (
    <article
      className="product-card comparison-card"
      key={`${product.title}-${index}`}
    >
      <div className="product-image-wrap">
        <img
          className="product-image"
          src={image}
          alt={product.title || "Product"}
          onError={(event) => {
            event.currentTarget.onerror = null;
            event.currentTarget.src = PLACEHOLDER_IMAGE;
          }}
        />
        <span className="price-status">PRICE COMPARISON</span>
      </div>

      <div className="product-info">
        <span className="product-retailer">
          {pricedOffers.length} priced offer
          {pricedOffers.length === 1 ? "" : "s"}
          {" · "}
          {offers.length} total listing
          {offers.length === 1 ? "" : "s"}
        </span>

        <h3>{product.title}</h3>

        <div className="comparison-lowest">
          <span className="comparison-label">LOWEST REPORTED PRICE</span>
          <div className="product-price">
            {cheapest ? money(cheapest.price) : "Price unavailable"}
          </div>

          {cheapest && (
            <span className="comparison-winner">
              Lowest listed offer: {cheapest.retailer}
            </span>
          )}

          {pricedOffers.length > 1 && savings > 0 && (
            <span className="comparison-savings">
              Difference between highest and lowest: {money(savings)}
            </span>
          )}
        </div>

        <div className="offer-list">
          <div className="offer-list-heading">
            <span>RETAILER</span>
            <span>PRICE</span>
            <span>LINK</span>
          </div>

          {sortedOffers.map((offer, offerIndex) => {
            const price = Number(offer.price);
            const hasPrice =
              Number.isFinite(price) && price > 0;

            const isCheapest =
              hasPrice &&
              cheapest &&
              price === Number(cheapest.price);

            return (
              <div
                className={`offer-row ${
                  isCheapest ? "offer-row-cheapest" : ""
                }`}
                key={`${offer.retailer}-${offer.url}-${offerIndex}`}
              >
                <div className="offer-retailer-cell">
                  <span className="offer-retailer-name">
                    {offer.retailer || "Unknown retailer"}
                  </span>

                  {isCheapest && (
                    <span className="offer-best-badge">
                      LOWEST
                    </span>
                  )}
                </div>

                <strong className="offer-price">
                  {hasPrice ? money(price) : "Unavailable"}
                </strong>

                {offer.url ? (
                  <a
                    className="offer-link"
                    href={offer.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {offer.link_type === "retailer_direct"
                      ? "Visit store ↗"
                      : "View offer ↗"}
                  </a>
                ) : (
                  <span className="offer-link-unavailable">No link</span>
                )}
              </div>
            );
          })}
        </div>

        {cheapest?.url && (
          <a
            className="btn-primary lowest-link"
            href={cheapest.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open lowest listed offer ↗
          </a>
        )}

        <p className="verification-note">
          Prices are reported by the search provider and may change.
          Check the exact model, specifications, seller, delivery fees
          and final checkout price before buying.
        </p>

        {offers.some((offer) =>
          ["claimed_discount_unverified", "suspicious_claim"].includes(
            offer.discount_warning?.status
          )
        ) && (
          <p className="discount-warning">
            ⚠ Some offers contain unverified discount claims.
            This is a warning, not proof of fraud.
          </p>
        )}

        <div className="product-actions">
          <button
            className="btn-primary"
            onClick={() => onTrack(product)}
            disabled={trackingId === product.title}
            type="button"
          >
            {trackingId === product.title
              ? "Tracking..."
              : "♡ Track product"}
          </button>
        </div>
      </div>
    </article>
  );
}

            const external = isExternalProduct(product);
            const price = getProductPrice(product);
            const key = external
              ? `${product.url || product.title}-${index}`
              : product.id;

            return (
              <article className="product-card" key={key}>
                <div className="product-image-wrap">
                  <img
                    className="product-image"
                    src={getProductImage(product)}
                    alt={product.title || "Product"}
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.src = PLACEHOLDER_IMAGE;
                    }}
                  />
                  <span className="price-status">
                    {getPriceLabel(product)}
                  </span>
                </div>

                <div className="product-info">
                  <span className="product-retailer">
                    {getRetailerName(product)}
                  </span>
                  <h3>{product.title}</h3>
                  <div className="product-price">
                    {money(price, product.currency || "INR")}
                  </div>

                  <p className="verification-note">
                    {external
                      ? price != null && Number(price) > 0
                        ? "Price reported by the search provider; confirm it on the retailer's website."
                        : "The provider did not return a usable price for this listing."
                      : "Catalog price; verify on the retailer's website."}
                  </p>

                  <div className="product-actions">
                    {external ? (
                      <button
                        className="btn-primary"
                        onClick={() => onTrack(product)}
                        type="button"
                      >
                        ♡ Track product
                      </button>
                    ) : (
                      <button
                        className="btn-primary"
                        onClick={() => onTrack(product)}
                        disabled={trackingId === product.id}
                        type="button"
                      >
                        {trackingId === product.id
                          ? "Tracking..."
                          : "♡ Track product"}
                      </button>
                    )}

                    {product.url && (
                      <a
                        href={product.url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-icon"
                        aria-label="Open retailer listing"
                      >
                        ↗
                      </a>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WatchlistPage({ items, loading, onRemove, onNavigate, token }) {
  const [historyFor, setHistoryFor] = useState(null);
  const [historyData, setHistoryData] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [targetValues, setTargetValues] = useState({});
  const openHistory = async (item) => {
    setHistoryFor(item.subscription_id);
    setHistoryData(null);
    setHistoryLoading(true);
    try {
      const response = await axios.get(`${API}/api/products/watchlist/${item.subscription_id}/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setHistoryData(response.data);
    } catch {
      setHistoryData({ error: "Could not load price history yet." });
    } finally {
      setHistoryLoading(false);
    }
  };
  const saveTarget = async (item) => {
    const raw = targetValues[item.subscription_id];
    try {
      await axios.patch(`${API}/api/products/watchlist/${item.subscription_id}/target`,
        { target_price: raw ? Number(raw) : null },
        { headers: { Authorization: `Bearer ${token}` } });
      window.alert("Target price saved. Email alerts require SMTP configuration in the backend environment.");
    } catch { window.alert("Could not save target price."); }
  };
  return (
    <div className="page-stack">
      <section className="page-intro">
        <span className="eyebrow">YOUR PERSONAL COLLECTION</span>
        <h2>
          Things worth <span>watching.</span>
        </h2>
        <p>Your tracked products, in one place.</p>
      </section>

      <div className="watchlist-summary">
        <div>
          <span className="eyebrow">SAVED PRODUCTS</span>
          <strong>{items.length.toString().padStart(2, "0")}</strong>
        </div>
        <span className="watchlist-heart">♡</span>
      </div>

      {loading ? (
        <div className="empty-state">
          <span className="loader" /> Loading your watchlist...
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">♡</div>
          <h3>Your watchlist is waiting</h3>
          <p>Search the saved catalog and track products you want to follow.</p>
          <button
            className="btn-primary"
            onClick={() => onNavigate("search")}
            type="button"
          >
            Find products <span>↗</span>
          </button>
        </div>
      ) : (
        <div className="watchlist-list">
          {items.map((item) => (
            <article
              className="watchlist-item"
              key={item.subscription_id}
            >
              <img
                src={getProductImage(item)}
                alt={item.title}
                onError={(event) => {
                  event.currentTarget.onerror = null;
                  event.currentTarget.src = PLACEHOLDER_IMAGE;
                }}
              />

              <div className="watchlist-product">
                <span className="product-retailer">
                  {getRetailerName(item)}
                </span>
                <h3>{item.title}</h3>
                <span className="verification-note">
                  Catalog price; verify before purchase.
                </span>
              </div>

              <div className="watchlist-price">
                <small>CURRENT LISTED PRICE</small>
                <strong>{money(item.current_price)}</strong>
                <small>
                  Target:{" "}
                  {item.target_price == null
                    ? "Not set"
                    : money(item.target_price)}
                </small>
              </div>

              <div className="watchlist-actions">
                {item.url && (
                  <a
                    className="btn-secondary"
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View ↗
                  </a>
                )}
                <button className="btn-secondary" onClick={() => openHistory(item)} type="button">Price history</button>
                <button className="btn-danger" onClick={() => onRemove(item.subscription_id)} type="button">Remove</button>
              </div>
              <div className="target-price-editor">
                <label>Alert me at (₹)</label>
                <input type="number" min="1" placeholder={item.target_price ?? "Target price"}
                  value={targetValues[item.subscription_id] ?? ""}
                  onChange={(event) => setTargetValues((old) => ({ ...old, [item.subscription_id]: event.target.value }))} />
                <button className="btn-secondary" type="button" onClick={() => saveTarget(item)}>Save target</button>
              </div>
              {historyFor === item.subscription_id && (
                <div className="history-card">
                  <div className="history-card-heading"><h4>Price history · {item.title}</h4><button type="button" className="btn-icon" onClick={() => setHistoryFor(null)}>×</button></div>
                  {historyLoading ? <p>Loading history…</p> : historyData?.error ? <p>{historyData.error}</p> : historyData ? (
                    <>
                      <div className="history-stats"><span>Average drop <strong>{money(historyData.average_drop)}</strong></span><span>Average rise <strong>{money(historyData.average_rise)}</strong></span><span>Net change <strong>{money(historyData.net_change)}</strong></span></div>
                      {historyData.history?.length > 1 ? <PriceHistoryGraph history={historyData.history} /> : <p>Not enough recorded price points yet. As new checks are saved, the graph will appear here.</p>}
                    </>
                  ) : null}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}


function PriceHistoryGraph({ history }) {
  const values = history.map((point) => Number(point.price)).filter(Number.isFinite);
  if (values.length < 2) return <p>Not enough price history yet.</p>;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => `${index / (values.length - 1) * 560},${110 - ((value - min) / span) * 90}`).join(" ");
  return <div className="price-history-chart"><svg viewBox="0 0 560 125" role="img" aria-label="Recorded product price history"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />{values.map((value, index) => <circle key={index} cx={index / (values.length - 1) * 560} cy={110 - ((value - min) / span) * 90} r="3.5" fill="currentColor" />)}</svg><div className="chart-range"><span>Low: {money(min)}</span><span>High: {money(max)}</span></div></div>;
}

function ProfilePage({
  user,
  email,
  setEmail,
  password,
  setPassword,
  authMode,
  setAuthMode,
  loading,
  onSubmit,
  onLogout,
  onNavigate,
}) {
  return (
    <div className="page-stack">
      <section className="page-intro">
        <span className="eyebrow">YOUR ACCOUNT, YOUR RULES</span>
        <h2>
          Make it <span>personal.</span>
        </h2>
        <p>Manage your account and make shopping research yours.</p>
      </section>

      <div className="account-layout">
        <section className="account-intro">
          <div className="account-graphic">
            <div className="account-graphic-ring" />
            <span>✳</span>
          </div>
          <span className="eyebrow">PRICE TRACKER MEMBER SPACE</span>
          <h2>
            Good decisions start with <span>good information.</span>
          </h2>
          <p>
            Keep your tracked products together and return to your shopping
            research whenever you need it.
          </p>
          <div className="account-benefit">
            <span>✓</span> Personal tracked-product list
          </div>
          <div className="account-benefit">
            <span>✓</span> Saved account session
          </div>
          <div className="account-benefit">
            <span>✓</span> Dark and light appearance
          </div>
        </section>

        <section className="auth-card">
          {user ? (
            <div className="signed-in">
              <div className="signed-avatar">
                {user.charAt(0).toUpperCase()}
              </div>
              <span className="eyebrow">ACCOUNT CONNECTED</span>
              <h2>You're in.</h2>
              <p className="signed-email">{user}</p>
              <div className="account-detail-row">
                <span>Account status</span>
                <strong>
                  <span className="status-dot online" /> Logged in
                </strong>
              </div>
              <button
                className="btn-primary full-width"
                onClick={() => onNavigate("watchlist")}
                type="button"
              >
                View tracked products ↗
              </button>
              <button
                className="btn-danger full-width"
                onClick={onLogout}
                type="button"
              >
                Log out
              </button>
            </div>
          ) : (
            <>
              <span className="eyebrow">WELCOME TO YOUR SPACE</span>
              <h2>
                {authMode === "login"
                  ? "Welcome back."
                  : "Let's get started."}
              </h2>
              <p className="auth-description">
                {authMode === "login"
                  ? "Log in to pick up where you left off."
                  : "Create an account to start your own watchlist."}
              </p>

              <div className="auth-tabs">
                <button
                  type="button"
                  className={authMode === "login" ? "selected" : ""}
                  onClick={() => setAuthMode("login")}
                >
                  Log in
                </button>
                <button
                  type="button"
                  className={authMode === "register" ? "selected" : ""}
                  onClick={() => setAuthMode("register")}
                >
                  Create account
                </button>
              </div>

              <form className="auth-form" onSubmit={onSubmit}>
                <label htmlFor="account-email">EMAIL ADDRESS</label>
                <input
                  id="account-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />

                <label htmlFor="account-password">PASSWORD</label>
                <input
                  id="account-password"
                  type="password"
                  autoComplete={
                    authMode === "login"
                      ? "current-password"
                      : "new-password"
                  }
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={6}
                  required
                />

                <button
                  className="btn-primary full-width"
                  disabled={loading}
                  type="submit"
                >
                  {loading
                    ? "Please wait..."
                    : authMode === "login"
                      ? "Log in to account ↗"
                      : "Create my account ↗"}
                </button>
              </form>

              <p className="auth-footnote">
                Never share your password or access token.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
