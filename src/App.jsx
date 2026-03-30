import React, { useState, useEffect, useRef, createContext, useContext } from "react";
import {
  supabase,
  loadFromCloud,
  saveToCloud,
  signInWithEmail,
  signInWithGoogle,
  supabaseSignOut,
} from "./supabase.js";

// ── Claude API helper ───────────────────────────────────────────────────────
// Routes all Anthropic calls through /api/claude (server-side key, rate limiting)
async function callClaude(anthropicBody, callType = "chat") {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = { "Content-Type": "application/json" };
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

  const res = await fetch("/api/claude", {
    method: "POST",
    headers,
    body: JSON.stringify({ anthropicBody, callType }),
  });

  if (res.status === 429) {
    const info = await res.json();
    window.dispatchEvent(new CustomEvent("oracle-rate-limit", { detail: info }));
    throw Object.assign(new Error("rate_limit"), { info });
  }
  if (!res.ok) throw new Error(`claude_error_${res.status}`);
  return res.json();
}

// localStorage shim — matches the window.storage API shape used throughout
// (window.storage only exists inside Claude artifacts; this makes the app work in real browsers)
const storage = {
  get: (key) => {
    try {
      const val = localStorage.getItem(key);
      if (val === null) throw new Error("not found");
      return Promise.resolve({ key, value: val });
    } catch {
      return Promise.reject(new Error("not found"));
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
      return Promise.resolve({ key, value });
    } catch (e) {
      return Promise.reject(e);
    }
  },
  delete: (key) => {
    try {
      localStorage.removeItem(key);
      return Promise.resolve({ key, deleted: true });
    } catch (e) {
      return Promise.reject(e);
    }
  },
};

const DarkContext = createContext(false);

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Unicase:wght@300;400;500;600&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Montserrat:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --ink: #0a0a0a;
    --paper: #f5f2ed;
    --paper-dark: #ede9e2;
    --ash: #6a6664;
    --silver: #6e6a68;
    --rule: rgba(10,10,10,0.11);
    --red-suit: #b83232;
    --card-bg: #fdfaf5;
    --nav-bg: #f0ece5;
    --nav-border: rgba(10,10,10,0.08);
    --font-display: 'Cormorant Unicase', Georgia, serif;
    --font-body: 'Cormorant Garamond', Georgia, serif;
    --font-mono: 'Montserrat', sans-serif;
    --card-radius: 4px;
    --card-shadow: 1px 2px 8px rgba(0,0,0,0.10);
    --inner-inset: inset 0 0 0 1px rgba(10,10,10,0.06);
  }

  .dark {
    --ink: #f0ece4;
    --paper: #0a0908;
    --paper-dark: #111009;
    --ash: #8c8884;
    --silver: #888480;
    --rule: rgba(240,236,228,0.09);
    --red-suit: #c94040;
    --card-bg: #181512;
    --nav-bg: #060504;
    --nav-border: rgba(240,236,228,0.07);
    --inner-inset: inset 0 0 0 1px rgba(240,236,228,0.05);
    --card-shadow: 1px 2px 16px rgba(0,0,0,0.55);
  }

  /* Global Montserrat override */
  .bnav-label, .form-label, .deck-chip, .style-chip-desc, .submit-btn,
  .back-btn, .context-btn, .context-card-label,
  .modal-close, .modal-eyebrow, .modal-reflection-label, .modal-save-btn,
  .header-eyebrow, .header-date, .view-toggle-label, .view-btn,
  .pull-cta-sub, .today-label, .cal-day-header, .cal-date,
  .timeline-month-label, .tag-pill,
  .loading-eyebrow, .loading-phrase,
  .settings-label, .settings-section-title, .profile-eyebrow {
    font-family: 'Montserrat', sans-serif !important;
    text-transform: uppercase !important;
    letter-spacing: 0.22em !important;
    font-weight: 500;
  }

  body {
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-body);
    min-height: 100vh;
    overflow-x: clip; /* clip without creating a scroll container — numerals can still escape via absolute positioning */
    transition: background 0.3s ease, color 0.3s ease;
  }

  body::before {
    content: '';
    position: fixed; inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E");
    pointer-events: none; z-index: 9998; opacity: 0.7;
  }

  button { cursor: pointer; border: none; background: none; font-family: inherit; }
  input, textarea, select { font-family: inherit; }

  .app { max-width: 720px; margin: 0 auto; padding: 0 24px 96px; }
  /* Full-bleed — breaks out of 24px app padding to span full width */
  .rule-bleed {
    border: none; border-top: 1px solid var(--rule);
    margin-left: -24px; margin-right: -24px;
  }
  .hover-bleed:hover {
    margin-left: -24px; margin-right: -24px;
    padding-left: 24px; padding-right: 24px;
    border-radius: 0;
  }

  /* ── LOADING SCREEN ── */
  .loading-screen {
    position: fixed; inset: 0;
    background: #080808;
    z-index: 9999;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
  }
  .loading-eyebrow {
    font-size: 9px; letter-spacing: 0.28em; color: rgba(245,242,237,0.55);
    margin-bottom: 56px;
  }
  .loading-suits { display: flex; gap: 32px; align-items: center; margin-bottom: 36px; }
  .loading-suit { transition: opacity 0.25s ease, filter 0.25s ease; /* NO size transition */ }
  .loading-card-name {
    font-family: 'Cormorant Unicase', Georgia, serif;
    font-size: 28px; font-weight: 300; letter-spacing: 0.04em;
    color: rgba(245,242,237,0.85); margin-bottom: 28px; text-transform: lowercase;
    display: flex; align-items: center; gap: 8px;
  }
  .loading-divider { width: 1px; height: 32px; background: rgba(245,242,237,0.1); margin-bottom: 28px; }
  .loading-phrase {
    font-size: 10px; letter-spacing: 0.22em; color: rgba(245,242,237,0.55);
    text-align: center; max-width: 260px; line-height: 1.8;
    transition: opacity 0.6s ease; min-height: 40px;
    display: flex; align-items: center; justify-content: center;
  }
  .loading-dots { display: flex; gap: 9px; margin-top: 38px; }
  .loading-dot {
    width: 3px; height: 3px; border-radius: 50%;
    background: rgba(245,242,237,0.55);
    animation: dotPulse 1.5s ease-in-out infinite;
  }
  .loading-dot:nth-child(2) { animation-delay: 0.22s; }
  .loading-dot:nth-child(3) { animation-delay: 0.44s; }
  @keyframes dotPulse { 0%,80%,100%{opacity:.25;transform:scale(1)} 40%{opacity:1;transform:scale(1.5)} }

  /* ── BOTTOM NAV ── */
  .bottom-nav {
    position: fixed; bottom: 0; left: 0; right: 0;
    background: var(--nav-bg);
    border-top: 1px solid var(--nav-border);
    display: flex; align-items: stretch;
    z-index: 100;
    transition: background 0.3s ease;
    max-width: 100vw;
  }
  .bnav-item {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: flex-end;
    padding: 10px 8px 10px; gap: 4px;
    cursor: pointer; border: none; background: none;
    color: var(--silver); transition: color 0.2s;
    position: relative;
  }
  .bnav-item.active { color: var(--ink); }
  .bnav-item.active::before {
    content: ''; position: absolute; top: 0; left: 25%; right: 25%;
    height: 1.5px; background: var(--ink);
    transition: background 0.3s;
  }
  .bnav-icon { width: 22px; }
  .bnav-label { font-size: 8px !important; letter-spacing: 0.22em !important; margin-top: 3px; }

  /* ── PULL (CENTER) NAV ITEM — elevated ── */
  .bnav-pull {
    flex: 1.2; position: relative;
    display: flex; flex-direction: column;
    align-items: center; justify-content: flex-end;
    padding-bottom: 10px;
    padding-top: 0;
  }
  .bnav-pull-inner {
    position: absolute; top: -24px; left: 50%; transform: translateX(-50%);
    width: 48px; height: 48px; border-radius: 50%;
    background: var(--ink); color: var(--paper);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; border: none;
    box-shadow: 0 4px 20px rgba(0,0,0,0.22), var(--inner-inset);
    transition: all 0.2s ease;
  }
  .bnav-pull-inner:hover { transform: translateX(-50%) scale(1.06); }
  .bnav-pull-inner.active { background: var(--ink); animation: none; }
  .bnav-pull-inner.active.beckoning { background: var(--ink); animation: none; }
  .bnav-pull-label {
    font-family: 'Montserrat', sans-serif;
    font-size: 8px; letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--silver); font-weight: 500; margin-top: 3px;
    position: relative; z-index: 1;
  }
  .bnav-pull-inner.beckoning ~ .bnav-pull-label { color: var(--red-suit); }

  /* ── HEADER ── */
  .header {
    padding: 52px 0 28px;
    border-bottom: 1px solid var(--rule);
    margin-bottom: 36px;
    margin-left: -24px; margin-right: -24px; padding-left: 24px; padding-right: 24px;
    display: flex; justify-content: space-between; align-items: flex-end;
  }
  .header-eyebrow { font-size: 9px; color: var(--ash); margin-bottom: 10px; }
  .header-title {
    font-family: var(--font-display);
    font-size: clamp(38px, 6vw, 56px);
    font-weight: 300; letter-spacing: 0.01em; line-height: 0.81;
    color: var(--ink); text-transform: lowercase;
  }
  .header-title em { font-style: normal; font-weight: 400; letter-spacing: 0em; }
  .header-right { text-align: right; }
  .header-date { font-size: 9px; color: var(--ash); letter-spacing: 0.20em; line-height: 1.8; }
  .header-suits { display: flex; gap: 12px; align-items: center; justify-content: center; }

  /* Persistent suit icons bar — lives above all page content, never fades */
  .app-suits-bar {
    display: flex; gap: 16px; align-items: center; justify-content: center;
    padding: 44px 0 0;
  }
  .app-suits-bar-icon {
    transition: color 0.22s ease, filter 0.22s ease;
    display: flex;
  }

  /* ── PULL CTA ── */
  .pull-cta {
    display: flex; align-items: center; justify-content: space-between;
    padding: 22px 26px; border: 1px solid var(--ink);
    border-radius: var(--card-radius); margin-bottom: 40px;
    cursor: pointer; width: 100%; text-align: left;
    position: relative; overflow: hidden; background: transparent;
    box-shadow: var(--inner-inset); transition: all 0.2s;
  }
  .pull-cta::after {
    content: ''; position: absolute; inset: 0;
    background: var(--ink); transform: scaleX(0);
    transform-origin: left; transition: transform 0.3s cubic-bezier(0.4,0,0.2,1); z-index: 0;
  }
  .pull-cta:hover::after { transform: scaleX(1); }
  .pull-cta > * { position: relative; z-index: 1; transition: color 0.3s; }
  .pull-cta:hover .pull-cta-label,
  .pull-cta:hover .pull-cta-sub,
  .pull-cta:hover .pull-cta-arrow { color: var(--paper); }
  .pull-cta-label {
    font-family: var(--font-display);
    font-size: 24px; font-weight: 500; letter-spacing: 0.01em;
    text-transform: lowercase; color: var(--ink);
  }
  .pull-cta-sub { font-size: 10px; color: var(--ash); margin-top: 3px; }
  .pull-cta-arrow { font-size: 18px; color: var(--ink); }

  /* ── TODAY STRIP ── */
  .today-strip {
    margin-bottom: 32px; padding: 20px 24px;
    border: 1px solid var(--rule); border-left: 2px solid var(--ink);
    border-radius: var(--card-radius); cursor: pointer;
    transition: background 0.15s;
    box-shadow: var(--card-shadow), var(--inner-inset);
  }
  .today-strip:hover { background: var(--paper-dark); }
  .today-label { font-size: 10px; color: var(--ash); margin-bottom: 6px; }
  .today-card { font-family: var(--font-display); font-size: 30px; font-weight: 400; letter-spacing: 0.01em; text-transform: lowercase; }
  .today-preview { font-family: var(--font-body); font-size: 12px; color: var(--ash); margin-top: 5px; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  /* ── VIEW TOGGLE ── */
  /* ── VAULT PAGE TABS ── */
  .vault-header {
    padding: 52px 0 0; margin-bottom: 0;
  }
  .vault-topbar {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 28px;
  }
  .vault-topbar-slot {
    width: 36px; height: 36px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .dots-menu-btn {
    width: 32px; height: 32px;
    display: flex; align-items: center; justify-content: center;
    background: none; border: none; cursor: pointer;
    color: var(--silver); border-radius: 50%;
    transition: color 0.15s;
    flex-shrink: 0;
  }
  .dots-menu-btn:hover { color: var(--ink); }
  /* keep old name for vault topbar compat */
  .vault-settings-btn {
    width: 32px; height: 32px;
    display: flex; align-items: center; justify-content: center;
    background: none; border: none; cursor: pointer;
    color: var(--silver); border-radius: 50%;
    transition: color 0.15s; flex-shrink: 0;
  }
  .vault-settings-btn:hover { color: var(--ink); }
  .vault-title {
    font-family: var(--font-display); font-size: clamp(32px,6vw,50px);
    font-weight: 300; letter-spacing: 0.01em; text-transform: lowercase;
    color: var(--ink); text-align: center; flex: 1;
  }
  .vault-title em { font-style: normal; font-weight: 400; letter-spacing: 0em; }
  .vault-tabs {
    display: grid; grid-template-columns: 1fr 1fr;
    border-bottom: 1px solid var(--rule);
    margin-bottom: 28px;
    margin-left: -24px; margin-right: -24px;
  }
  .vault-tab {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    padding: 12px 0 14px;
    font-family: 'Montserrat', sans-serif; font-size: 9px;
    letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--silver); background: none; border: none;
    cursor: pointer; transition: color 0.15s;
    border-bottom: 2px solid transparent; margin-bottom: -1px;
  }
  .vault-tab:hover { color: var(--ash); }
  .vault-tab.active { color: var(--ink); border-bottom-color: var(--ink); }
  .vault-tab svg { opacity: 0.6; }
  .vault-tab.active svg { opacity: 1; }

  /* ── CALENDAR ── */
  .cal-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .cal-month { font-family: var(--font-display); font-size: 30px; font-weight: 400; letter-spacing: 0.01em; text-transform: lowercase; }
  .cal-nav-btn {
    font-family: 'Montserrat', sans-serif;
    font-size: 8px; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--ash); padding: 7px 0;
    width: calc(100% / 7); text-align: center;
    border: 1px solid var(--rule); border-radius: var(--card-radius);
    transition: all 0.15s; font-weight: 500;
  }
  .cal-nav-btn:hover { color: var(--ink); border-color: var(--ink); }
  .cal-grid {
    display: grid; grid-template-columns: repeat(7, 1fr);
    gap: 1px; background: var(--rule);
    border: 1px solid var(--rule); border-radius: var(--card-radius);
  }
  .cal-day-header { font-size: 9px; color: var(--ash); padding: 6px 4px; text-align: center; background: var(--paper); font-weight: 500; }
  .cal-cell { background: var(--paper); min-height: 86px; padding: 6px 4px 8px; position: relative; transition: background 0.12s; overflow: visible; }
  .cal-cell.has-pull:hover { z-index: 10; }
  .cal-cell.other-month { opacity: 1; background: var(--paper-dark); }
  .cal-cell.has-pull { cursor: pointer; }
  .cal-cell.has-pull:hover { background: var(--paper-dark); }
  .cal-empty-cell { opacity: 1; transition: opacity 0.15s; }
  .cal-cell:not(.has-pull):not(.today):hover .cal-empty-cell { opacity: 1; }
  .cal-cell.today { background: transparent; }  /* color set inline, suit-aware */
  .cal-date { font-size: 9px; color: var(--ash); letter-spacing: 0.04em; text-align: center; width: 100%; font-weight: 500; }
  .cal-cell.today .cal-date { color: #fff; font-weight: 600; }

  .card-skew { transform-origin: center center; transition: transform 0.2s ease; filter: drop-shadow(1px 3px 6px rgba(0,0,0,0.12)); }
  .card-skew:hover { transform: rotate(0deg) scale(1.08) !important; filter: drop-shadow(2px 5px 14px rgba(0,0,0,0.2)); }

  /* ── TIMELINE ── */
  .timeline-month-label { font-size: 9px; color: var(--ash); padding: 24px 0 10px; border-bottom: 1px solid var(--rule); margin-left: -24px; margin-right: -24px; padding-left: 24px; padding-right: 24px; }
  /* ── Resonance module ── */
  .resonance-module {
    margin-top: 24px; padding-top: 20px;
    border-top: 1px solid var(--rule);
  }
  .resonance-label {
    font-family: 'Montserrat', sans-serif; font-size: 8px;
    letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--silver); margin-bottom: 14px; text-align: center;
  }
  .resonance-track {
    position: relative; padding: 4px 0 24px;
  }
  .resonance-words {
    display: flex; justify-content: space-between;
    margin-bottom: 10px;
  }
  .resonance-word {
    font-family: var(--font-display); font-size: 13px;
    font-weight: 300; letter-spacing: 0.02em; text-transform: lowercase;
    color: var(--silver); cursor: pointer; transition: all 0.2s;
    flex: 1; text-align: center; padding: 4px 2px;
    border-radius: var(--card-radius);
  }
  .resonance-word:hover { color: var(--ash); }
  .resonance-word.active {
    color: var(--ink); font-weight: 400;
  }
  .resonance-word.active.red { color: var(--red-suit); }
  .resonance-slider-wrap {
    position: relative; height: 2px;
    background: var(--rule); border-radius: 1px;
    margin: 0 4px;
  }
  .resonance-slider-fill {
    position: absolute; left: 0; top: 0; height: 100%;
    background: var(--ink); border-radius: 1px;
    transition: width 0.3s ease;
  }
  .resonance-slider-fill.red { background: var(--red-suit); }
  .resonance-thumb {
    position: absolute; top: 50%;
    width: 14px; height: 14px;
    background: var(--ink); border-radius: 50%;
    transform: translate(-50%, -50%);
    transition: left 0.3s ease, background 0.3s ease;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    cursor: grab;
  }
  .resonance-thumb.red { background: var(--red-suit); }

  /* ── Timeline arrow ── */
  .timeline-arrow {
    font-size: 14px; color: var(--silver);
    flex-shrink: 0; align-self: center;
    transition: transform 0.15s, color 0.15s;
    margin-left: 8px;
  }
  .timeline-empty-day {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--rule);
    cursor: pointer;
    transition: opacity 0.15s;
    opacity: 0.6;
  }
  .timeline-empty-day:hover { opacity: 1; }
  .timeline-entry:hover .timeline-arrow {
    color: var(--ink); transform: translateX(3px);
  }

  .timeline-entry {
    display: grid; grid-template-columns: 56px 1fr auto;
    gap: 16px; padding: 16px 0;
    border-bottom: 1px solid var(--rule); cursor: pointer; transition: all 0.12s;
    align-items: center;
  }
  .timeline-entry:hover { background: var(--paper-dark); margin-left: -24px; margin-right: -24px; padding-left: 24px; padding-right: 24px; border-radius: 0; }
  .timeline-card-name {
    font-family: var(--font-display); font-size: 26px; font-weight: 400;
    letter-spacing: 0.01em; text-transform: lowercase; line-height: 0.85;
  }
  .timeline-meta {
    font-family: var(--font-display); font-size: 16px; font-weight: 300;
    letter-spacing: 0.01em; text-transform: lowercase;
    color: var(--ash); line-height: 0.85;
  }
  .timeline-preview {
    font-family: 'Montserrat', sans-serif; font-size: 11px; font-weight: 400;
    color: var(--ash); margin-top: 7px; line-height: 1.7;
    letter-spacing: 0.02em;
    display: -webkit-box; -webkit-line-clamp: 2;
    -webkit-box-orient: vertical; overflow: hidden;
  }
  .tag-pill { display: inline-block; font-size: 10px; padding: 3px 7px; border: 1px solid var(--rule); color: var(--silver); margin-right: 5px; margin-top: 4px; border-radius: 2px; }

  /* ── ORACLE CHAT ── */
  /* ── Oracle Page — unified chat interface ── */

  /* Full-page oracle chat — lives in the tab, no overlay */
  .oracle-page {
    position: fixed;
    /* sit above app padding but below modal z-index */
    top: 0; left: 0; right: 0; bottom: 0;
    max-width: 720px; margin: 0 auto;
    display: flex; flex-direction: column;
    background: var(--paper);
    z-index: 50;
  }

  /* Sticky header */
  .oracle-page-header {
    flex-shrink: 0;
    padding: 52px 24px 16px;
    border-bottom: 1px solid var(--rule);
    display: flex; align-items: center; justify-content: space-between;
  }
  .oracle-page-title {
    font-family: var(--font-display); font-size: 28px; font-weight: 400;
    text-transform: lowercase; letter-spacing: 0.01em; color: var(--ink);
    display: flex; align-items: center; gap: 10px;
  }
  .oracle-page-meta {
    font-family: 'Montserrat', sans-serif; font-size: 8px;
    letter-spacing: 0.22em; text-transform: uppercase; color: var(--ash);
  }

  /* Scrollable message feed */
  .oracle-feed {
    flex: 1; overflow-y: auto;
    padding: 24px 24px 12px;
    display: flex; flex-direction: column; gap: 0;
    scroll-behavior: smooth;
  }

  /* Date divider chip — inline between message groups */
  .oracle-day-divider {
    display: flex; align-items: center; gap: 12px;
    margin: 28px 0 20px;
  }
  .oracle-day-divider::before,
  .oracle-day-divider::after {
    content: ''; flex: 1; height: 1px; background: var(--rule);
  }
  .oracle-day-chip {
    flex-shrink: 0;
    display: flex; align-items: center; gap: 8px;
    padding: 6px 12px;
    background: var(--paper-dark);
    border: 1px solid var(--rule);
    border-radius: 20px;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .oracle-day-chip:hover { border-color: var(--ash); }
  .oracle-day-chip-date {
    font-family: 'Montserrat', sans-serif; font-size: 7px;
    letter-spacing: 0.2em; text-transform: uppercase; color: var(--ash);
  }
  .oracle-day-chip-card {
    font-family: var(--font-display); font-size: 13px; font-weight: 400;
    text-transform: lowercase; letter-spacing: 0.01em;
  }

  /* Message group spacing */
  .oracle-msg-group { margin-bottom: 16px; }

  /* Individual message */
  .oracle-msg {
    display: flex; gap: 10px; align-items: flex-start;
    margin-bottom: 8px;
  }
  .oracle-msg.user { flex-direction: row-reverse; }
  .oracle-msg-avatar {
    width: 26px; height: 26px; border-radius: 50%;
    background: var(--ink); color: var(--paper);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; margin-top: 2px;
  }
  .oracle-msg.user .oracle-msg-avatar {
    background: var(--paper-dark); color: var(--ash);
    border: 1px solid var(--rule);
  }
  .oracle-msg-bubble {
    max-width: 84%; padding: 13px 16px;
    font-family: var(--font-body); font-size: 16px; font-weight: 400;
    line-height: 1.72; color: var(--ink);
    background: var(--paper-dark);
    border-radius: var(--card-radius);
    box-shadow: var(--inner-inset);
  }
  .oracle-msg.user .oracle-msg-bubble {
    background: var(--ink); color: var(--paper); box-shadow: none;
  }
  .oracle-msg-bubble.typing {
    display: flex; gap: 5px; align-items: center; padding: 14px 16px;
  }
  .oracle-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--ash); animation: blink 1.2s infinite;
  }
  .oracle-dot:nth-child(2) { animation-delay: 0.2s; }
  .oracle-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%,80%,100%{opacity:0.2} 40%{opacity:1} }

  /* Empty state */
  .oracle-empty-state {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 16px; padding: 48px 24px; text-align: center;
  }
  .oracle-empty-state-title {
    font-family: var(--font-display); font-size: 22px; font-weight: 400;
    text-transform: lowercase; color: var(--ash);
  }
  .oracle-empty-state-sub {
    font-family: 'Montserrat', sans-serif; font-size: 8px;
    letter-spacing: 0.22em; text-transform: uppercase; color: var(--silver);
  }

  /* Fixed input bar */
  .oracle-input-row {
    position: fixed;
    bottom: 56px; left: 0; right: 0;
    z-index: 95;
    padding: 10px 16px 12px;
    border-top: 1px solid var(--rule);
    display: flex; gap: 10px; align-items: flex-end;
    background: var(--paper);
    max-width: 720px; margin: 0 auto;
  }
  .oracle-input {
    flex: 1; background: var(--paper-dark); border: 1px solid var(--rule);
    border-radius: var(--card-radius); padding: 12px 14px;
    font-family: var(--font-body); font-size: 16px; color: var(--ink);
    resize: none; min-height: 44px; max-height: 120px; outline: none;
    line-height: 1.5; transition: border-color 0.15s;
  }
  .oracle-input:focus { border-color: var(--ash); }
  /* Red send button — spade rotated 90deg as arrow */
  .oracle-send {
    width: 44px; height: 44px; border-radius: 50%;
    background: var(--red-suit); color: #fff;
    display: flex; align-items: center; justify-content: center;
    border: none; cursor: pointer; flex-shrink: 0; transition: opacity 0.15s;
  }
  .oracle-send:disabled { opacity: 0.32; cursor: default; }
  .oracle-send:not(:disabled):hover { opacity: 0.8; }
  /* Suit thinking indicator — 4 suits blink in sequence while oracle responds */
  .oracle-thinking {
    display: flex; gap: 14px; align-items: center; justify-content: center;
    padding: 10px 0 4px;
  }
  .oracle-thinking-suit {
    opacity: 0.12;
    animation: thinkBlink 1.6s ease-in-out infinite;
  }
  .oracle-thinking-suit:nth-child(1) { animation-delay: 0s; }
  .oracle-thinking-suit:nth-child(2) { animation-delay: 0.2s; }
  .oracle-thinking-suit:nth-child(3) { animation-delay: 0.4s; }
  .oracle-thinking-suit:nth-child(4) { animation-delay: 0.6s; }
  @keyframes thinkBlink {
    0%,100% { opacity: 0.12; }
    30%     { opacity: 0.9; }
    60%     { opacity: 0.12; }
  }

  /* Oracle open button on home/archive (small link style) */
  .oracle-open-btn {
    display: flex; align-items: center; gap: 8px;
    font-family: 'Montserrat', sans-serif; font-size: 9px;
    letter-spacing: 0.22em; text-transform: uppercase; color: var(--ash);
    padding: 10px 0; cursor: pointer; background: none; border: none;
    border-top: 1px solid var(--rule); width: 100%; margin-top: 16px;
    transition: color 0.15s;
  }
  .oracle-open-btn:hover { color: var(--ink); }
  .oracle-open-btn svg { width: 14px; height: 14px; opacity: 0.5; }

  /* ── Ghost card animation ── */
  .ghost-card {
    position: fixed; z-index: 500;
    pointer-events: none;
    transform-origin: center center;
    will-change: transform, opacity;
    border-radius: var(--card-radius);
    filter: drop-shadow(0 8px 24px rgba(0,0,0,0.22));
  }
  .ghost-card.flying {
    transition: transform 0.34s cubic-bezier(0.4,0,0.2,1), opacity 0.34s ease;
  }
  .ghost-card.resting {
    animation: ghostPulse 2.8s ease-in-out infinite;
  }
  .ghost-card.returning {
    transition: transform 0.28s cubic-bezier(0.4,0,0.2,1), opacity 0.28s ease;
  }
  @keyframes ghostPulse {
    0%,100% { filter: drop-shadow(0 6px 18px rgba(0,0,0,0.18)); }
    50%      { filter: drop-shadow(0 10px 28px rgba(0,0,0,0.30)) drop-shadow(0 0 12px rgba(139,18,18,0.12)); }
  }
  .dark .ghost-card.resting {
    animation: ghostPulseDark 2.8s ease-in-out infinite;
  }
  @keyframes ghostPulseDark {
    0%,100% { filter: drop-shadow(0 6px 18px rgba(0,0,0,0.4)); }
    50%      { filter: drop-shadow(0 10px 28px rgba(0,0,0,0.55)) drop-shadow(0 0 16px rgba(224,64,64,0.18)); }
  }

  /* ── MODAL ── */
  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.72);
    z-index: 200; display: flex; align-items: center; justify-content: center;
    padding: 24px; backdrop-filter: blur(3px); animation: fadeIn 0.18s ease;
  }
  @keyframes fadeIn { from{opacity:0} to{opacity:1} }
  .modal {
    background: var(--paper); max-width: 540px; width: 100%;
    max-height: 88vh; overflow-y: auto; padding: 44px;
    position: relative; border-radius: var(--card-radius);
    box-shadow: 0 24px 80px rgba(0,0,0,0.28), var(--inner-inset);
    animation: modalIn 0.28s cubic-bezier(0.4,0,0.2,1);
    /* Room for the anchored card at top-left */
    padding-top: 56px;
  }
  @keyframes modalIn {
    from { transform: translateY(20px) scale(0.97); opacity:0; }
    to   { transform: translateY(0) scale(1); opacity:1; }
  }
  /* Typewriter reveal on reading text */
  .modal-reading-wrap { overflow: hidden; }
  .modal-reading-line { animation: revealLine 0.4s ease both; }
  @keyframes revealLine {
    from { opacity:0; transform: translateY(6px); }
    to   { opacity:1; transform: translateY(0); }
  }
  /* Card anchor — top-left corner of modal, hovering over edge */
  .modal-card-anchor {
    position: absolute;
    top: -28px; left: -20px;
    z-index: 10;
    filter: drop-shadow(0 12px 32px rgba(0,0,0,0.22));
    animation: anchorIn 0.38s cubic-bezier(0.34,1.56,0.64,1) both;
    cursor: pointer;
  }
  .modal-card-anchor:hover { filter: drop-shadow(0 16px 40px rgba(0,0,0,0.3)); }
  @keyframes anchorIn {
    from { transform: scale(0.72) translate(-12px,12px); opacity:0; }
    to   { transform: scale(1) translate(0,0); opacity:1; }
  }
  /* Centered header with left indent to clear the card */
  .modal-header {
    text-align: center;
    padding-bottom: 18px;
    margin-bottom: 4px;
  }
  .modal-close { position: absolute; top: 16px; right: 20px; font-size: 10px; color: var(--silver); padding: 6px; transition: color 0.15s; }
  .modal-close:hover { color: var(--ink); }
  .modal-eyebrow { font-size: 10px; color: var(--ash); margin-bottom: 10px; }
  .modal-card-title { font-family: var(--font-display); font-size: 42px; font-weight: 400; letter-spacing: 0.01em; text-transform: lowercase; line-height: 0.81; }
  .modal-rule { border: none; border-top: 1px solid var(--rule); margin: 20px 0; }
  .modal-reading { font-family: var(--font-body); font-size: 16px; font-weight: 400; line-height: 1.85; color: var(--ink); }
  .modal-reading p { margin-bottom: 14px; }
  .modal-reflection { margin-top: 28px; padding-top: 22px; border-top: 1px solid var(--rule); }
  .modal-reflection-label { font-size: 9px; color: var(--ash); margin-bottom: 9px; }
  .modal-reflection textarea {
    width: 100%; border: 1px solid var(--rule); border-radius: var(--card-radius);
    background: var(--paper-dark); padding: 12px; font-size: 13px; line-height: 1.65;
    resize: vertical; min-height: 80px; color: var(--ink); outline: none;
    font-family: var(--font-body); transition: border-color 0.15s; box-shadow: var(--inner-inset);
  }
  .modal-reflection textarea:focus { border-color: var(--ink); }
  .modal-save-btn {
    margin-top: 10px; font-size: 9px; padding: 8px 16px;
    border: 1px solid var(--ink); border-radius: var(--card-radius);
    color: var(--ink); transition: all 0.15s;
  }
  .modal-save-btn:hover { background: var(--ink); color: var(--paper); }

  /* ── PULL FORM ── */
  .pull-form { max-width: 580px; }
  .pull-form-title { font-family: var(--font-display); font-size: 36px; font-weight: 300; letter-spacing: 0.01em; text-transform: lowercase; margin-bottom: 36px; }
  .form-field { margin-bottom: 28px; }
  .form-label { display: block; font-size: 9px; color: var(--ash); margin-bottom: 10px; }
  .form-input {
    width: 100%; border: none; border-bottom: 1px solid var(--rule);
    background: transparent; padding: 8px 0; font-size: 17px; color: var(--ink);
    outline: none; transition: border-color 0.15s;
  }
  .form-input:focus { border-bottom-color: var(--ink); }
  .form-textarea {
    width: 100%; border: 1px solid var(--rule); border-radius: var(--card-radius);
    background: var(--paper-dark); padding: 13px; font-size: 14px; line-height: 1.65;
    color: var(--ink); outline: none; resize: vertical; min-height: 84px;
    transition: border-color 0.15s; box-shadow: var(--inner-inset);
  }
  .form-textarea:focus { border-color: var(--ink); }
  .deck-chips { display: flex; gap: 8px; flex-wrap: wrap; }
  .deck-chip {
    font-size: 9px; padding: 8px 16px; border: 1px solid var(--rule);
    border-radius: var(--card-radius); color: var(--ash);
    transition: all 0.15s; cursor: pointer; box-shadow: var(--inner-inset);
  }
  .deck-chip.selected { border-color: var(--ink); background: var(--ink); color: var(--paper); box-shadow: none; }

  /* ── Hero draw button — primary editorial CTA ── */
  .pull-hero {
    margin: 8px 0 40px;
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    padding: 40px 0;
    display: flex; flex-direction: column; align-items: center;
    gap: 20px;
  }
  .pull-hero-label {
    font-family: 'Montserrat', sans-serif; font-size: 8px;
    letter-spacing: 0.28em; text-transform: uppercase; color: var(--silver);
  }
  .pull-hero-suits {
    display: flex; gap: 12px; align-items: center;
    opacity: 0.18;
  }
  .pull-hero-count {
    font-family: var(--font-display); font-size: clamp(48px, 10vw, 72px);
    font-weight: 300; letter-spacing: 0.01em; text-transform: lowercase;
    color: var(--ink); line-height: 0.85; text-align: center;
    cursor: pointer; transition: opacity 0.2s;
    border: none; background: none; padding: 0;
    display: block; width: 100%;
  }
  .pull-hero-count:hover { opacity: 0.7; }
  .pull-hero-sub {
    font-family: 'Montserrat', sans-serif; font-size: 8px;
    letter-spacing: 0.22em; text-transform: uppercase; color: var(--ash);
  }

  /* Secondary mode row — manual + photo */
  .pull-secondary-row {
    display: flex; align-items: center; gap: 0;
    border: 1px solid var(--rule); border-radius: var(--card-radius);
    overflow: hidden; margin-bottom: 32px;
    box-shadow: var(--inner-inset);
  }
  .pull-mode-btn {
    flex: 1; padding: 13px 16px; cursor: pointer;
    border: none; background: transparent;
    font-family: 'Montserrat', sans-serif; font-size: 9px;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--ash); transition: all 0.15s;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .pull-mode-btn:hover { color: var(--ink); background: var(--paper-dark); }
  .pull-mode-btn.active { background: var(--ink); color: var(--paper); }
  .pull-mode-btn + .pull-mode-btn { border-left: 1px solid var(--rule); }
  .pull-mode-photo {
    flex: 0 0 auto; padding: 13px 16px;
    border-left: 1px solid var(--rule);
    font-family: 'Montserrat', sans-serif; font-size: 8px;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--silver); cursor: not-allowed; opacity: 0.5;
    border: none; background: transparent;
  }

  .style-chips { display: flex; gap: 8px; }
  .style-chip {
    flex: 1; padding: 16px 10px; border: 1px solid var(--rule);
    border-radius: var(--card-radius); text-align: center; cursor: pointer;
    transition: all 0.15s; box-shadow: var(--inner-inset);
  }
  .style-chip.selected { border-color: var(--ink); background: var(--ink); box-shadow: none; }
  .style-chip-name { font-family: var(--font-display); font-size: 18px; font-weight: 400; letter-spacing: 0.01em; text-transform: lowercase; color: var(--ink); transition: color 0.15s; }
  .style-chip.selected .style-chip-name { color: var(--paper); }
  .style-chip-desc { font-size: 10px; color: var(--ash); margin-top: 4px; transition: color 0.15s; }
  .style-chip.selected .style-chip-desc { color: rgba(245,242,237,0.5); }
  .submit-btn {
    font-size: 10px; padding: 15px 30px; border: 1px solid var(--ink);
    border-radius: var(--card-radius); color: var(--ink); background: transparent;
    transition: all 0.2s; box-shadow: var(--inner-inset);
  }
  .submit-btn:hover:not(:disabled) { background: var(--ink); color: var(--paper); box-shadow: none; }
  .submit-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .back-btn { font-size: 9px; color: var(--ash); margin-bottom: 36px; display: flex; align-items: center; gap: 7px; transition: color 0.15s; }
  .back-btn:hover { color: var(--ink); }

  /* ── Pull form — card selector redesign ── */
  .pull-card-stage {
    display: flex; flex-direction: column; align-items: center;
    position: relative; margin: 32px 0 40px; overflow: visible;
  }
  .pull-card-float {
    animation: offeringFloat 5s ease-in-out infinite;
    cursor: default; margin-bottom: 0;
  }
  /* Inline intention row */
  .pull-intention-row {
    width: 100%; display: flex; align-items: center; gap: 10px;
    margin-bottom: 32px;
    border: 1px solid var(--rule); border-radius: var(--card-radius);
    background: var(--paper-dark); box-shadow: var(--inner-inset);
    padding: 14px 14px 14px 18px;
    transition: border-color 0.2s;
  }
  .pull-intention-row:focus-within { border-color: var(--ash); }
  .pull-intention-text {
    flex: 1; border: none; background: transparent; outline: none;
    font-family: var(--font-body); font-size: 16px; font-style: italic;
    font-weight: 300; color: var(--ink); resize: none; line-height: 1.6;
    min-height: 24px;
  }
  .pull-intention-text::placeholder { color: var(--silver); font-style: italic; }
  .pull-intention-text:focus { font-style: normal; }
  .pull-intention-edit {
    font-family: 'Montserrat', sans-serif; font-size: 7px;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--silver); background: none; border: none;
    cursor: pointer; padding: 4px 0; flex-shrink: 0;
    transition: color 0.15s;
  }
  .pull-intention-edit:hover { color: var(--ink); }
  /* Section label */
  .pull-section-label {
    font-family: 'Montserrat', sans-serif; font-size: 7px;
    letter-spacing: 0.26em; text-transform: uppercase;
    color: var(--silver); font-weight: 500;
    display: block; margin-bottom: 10px;
  }
  /* Suit picker — 4 equal squares */
  .pull-suit-grid {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 8px; margin-bottom: 28px; width: 100%;
  }
  .pull-suit-btn {
    aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
    border: 1px solid var(--rule); border-radius: var(--card-radius);
    background: var(--paper-dark); cursor: pointer;
    box-shadow: var(--inner-inset);
    transition: all 0.15s;
  }
  .pull-suit-btn:hover { border-color: var(--ash); }
  .pull-suit-btn.selected {
    border-color: var(--ink); background: var(--ink); box-shadow: none;
  }
  .pull-suit-btn.selected-red {
    border-color: var(--red-suit); background: var(--red-suit); box-shadow: none;
  }
  /* Rank row — numerals */
  .pull-rank-numerals {
    display: grid; grid-template-columns: repeat(9, 1fr);
    gap: 6px; margin-bottom: 8px; width: 100%;
  }
  /* Face cards row */
  .pull-rank-faces {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 8px; margin-bottom: 32px; width: 100%;
  }
  .pull-rank-btn {
    padding: 10px 4px;
    display: flex; align-items: center; justify-content: center;
    border: 1px solid var(--rule); border-radius: var(--card-radius);
    background: var(--paper-dark); cursor: pointer;
    font-family: var(--font-display); font-size: 16px; font-weight: 300;
    letter-spacing: 0.02em; text-transform: lowercase;
    color: var(--ink); box-shadow: var(--inner-inset);
    transition: all 0.15s;
  }
  .pull-rank-btn:hover { border-color: var(--ash); }
  .pull-rank-btn.selected { border-color: var(--ink); background: var(--ink); color: var(--paper); box-shadow: none; }
  /* Receive reading CTA */
  .pull-receive-btn {
    width: 100%; padding: 18px 24px;
    background: var(--red-suit); color: #fff; border: none;
    border-radius: var(--card-radius);
    font-family: 'Montserrat', sans-serif; font-size: 9px; font-weight: 600;
    letter-spacing: 0.22em; text-transform: uppercase;
    cursor: pointer; transition: opacity 0.15s, transform 0.12s;
    position: relative; overflow: hidden;
    box-shadow: 0 2px 12px rgba(184,50,50,0.28);
    display: flex; align-items: center; justify-content: center; gap: 10px;
  }
  .pull-receive-btn::before {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(105deg, transparent 28%, rgba(255,255,255,0.15) 50%, transparent 72%);
    background-size: 200% 100%;
    animation: offeringShimmer 2.8s ease-in-out infinite; pointer-events: none;
  }
  .pull-receive-btn:disabled { opacity: 0.32; cursor: not-allowed; }
  .pull-receive-btn:disabled::before { animation: none; }
  .pull-receive-btn:not(:disabled):hover { opacity: 0.88; transform: translateY(-1px); }
  .reading-result { border-top: 1px solid var(--rule); padding-top: 36px; margin-top: 36px; }
  .reading-result-card { font-family: var(--font-display); font-size: 44px; font-weight: 400; letter-spacing: 0.01em; text-transform: lowercase; margin-bottom: 22px; color: var(--ink); }
  .reading-result-body { font-family: var(--font-body); font-size: 16px; line-height: 1.9; color: var(--ink); }
  .reading-result-body p { margin-bottom: 16px; }

  /* ── MINI CARD ── */
  .mini-card { flex-shrink: 0; border-radius: 3px; border: 1px solid rgba(10,10,10,0.18); overflow: visible; position: relative; }

  /* ── PROFILE / SETTINGS ── */
  /* ── Intake form ── */
  .intake-section {
    margin-bottom: 40px; padding-bottom: 40px;
    border-bottom: 1px solid var(--rule);
  }
  .intake-row {
    display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
    margin-bottom: 16px;
  }
  .intake-date {
    width: 100%; border: none; border-bottom: 1px solid var(--rule);
    background: transparent; padding: 8px 0; font-size: 15px;
    color: var(--ink); outline: none; font-family: var(--font-body);
    transition: border-color 0.15s;
  }
  .intake-date:focus { border-bottom-color: var(--ink); }
  .intake-save {
    width: 100%; margin-top: 8px;
    font-size: 9px; padding: 14px 24px;
    border: 1px solid var(--ink); border-radius: var(--card-radius);
    color: var(--ink); background: transparent;
    font-family: 'Montserrat', sans-serif;
    letter-spacing: 0.22em; text-transform: uppercase;
    transition: all 0.2s; cursor: pointer;
  }
  .intake-save:hover:not(:disabled) { background: var(--ink); color: var(--paper); }
  .intake-save:disabled { opacity: 0.35; cursor: not-allowed; }
  .intake-save.saved { background: var(--ink); color: var(--paper); }

  .profile-page { padding-top: 8px; }
  /* ── Settings page ── */
  .settings-page {
    padding: 0 24px 120px;
  }
  .settings-page-header {
    font-family: var(--font-display); font-size: 38px; font-weight: 300;
    text-transform: lowercase; letter-spacing: 0.02em;
    color: var(--ink); margin-bottom: 32px; padding-top: 12px;
  }
  /* ── Profile page ── */
  .origin-page { padding: 0 0 120px; }
  .origin-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 24px 0;
    font-family: var(--font-mono); font-size: 8px;
    letter-spacing: 0.22em; text-transform: uppercase; color: var(--ash);
    margin-bottom: 0;
  }
  .origin-title {
    font-family: var(--font-display); font-size: 38px; font-weight: 300;
    text-transform: lowercase; letter-spacing: 0.02em;
    color: var(--ink); padding: 8px 24px 24px;
  }
  .origin-avatar-wrap {
    display: flex; flex-direction: column; align-items: center;
    padding: 0 24px 28px; gap: 14px;
  }
  .origin-avatar {
    width: 88px; height: 88px; border-radius: 50%;
    background: var(--paper-dark); border: 1.5px solid var(--rule);
    display: flex; align-items: center; justify-content: center;
    overflow: hidden; position: relative; cursor: pointer;
    transition: border-color 0.2s;
  }
  .origin-avatar:hover { border-color: var(--ash); }
  .origin-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .origin-avatar-placeholder {
    font-size: 32px; color: var(--silver);
    font-family: var(--font-display); font-weight: 300;
    text-transform: lowercase;
  }
  .origin-avatar-edit-hint {
    font-family: 'Montserrat', sans-serif; font-size: 6px;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--silver); opacity: 0; transition: opacity 0.2s;
    position: absolute; bottom: 6px;
  }
  .origin-avatar:hover .origin-avatar-edit-hint { opacity: 1; }
  .origin-name {
    font-family: var(--font-display); font-size: 28px; font-weight: 300;
    text-transform: lowercase; color: var(--ink);
  }
  .origin-bio {
    font-family: var(--font-body); font-size: 14px; line-height: 1.7;
    color: var(--ash); text-align: center; max-width: 280px;
  }
  .origin-card-of-choice {
    display: flex; align-items: center; gap: 12px;
    padding: 16px 24px; margin: 0 24px 24px;
    border: 1px solid var(--rule); border-radius: var(--card-radius);
    background: var(--paper-dark);
  }
  .origin-card-label {
    font-family: 'Montserrat', sans-serif; font-size: 7px;
    letter-spacing: 0.18em; text-transform: uppercase; color: var(--ash);
    margin-bottom: 3px;
  }
  .origin-friends-section {
    padding: 0 24px; margin-top: 8px;
  }
  .origin-friends-empty {
    padding: 28px 0; text-align: center;
    font-family: 'Montserrat', sans-serif; font-size: 8px;
    letter-spacing: 0.16em; text-transform: uppercase; color: var(--silver);
    border: 1px dashed var(--rule); border-radius: var(--card-radius);
  }
  .origin-edit-row {
    display: flex; gap: 8px; padding: 0 24px; margin-bottom: 24px;
  }
  .origin-edit-input {
    flex: 1; background: var(--paper-dark); border: 1px solid var(--rule);
    border-radius: 4px; padding: 12px 16px; color: var(--ink);
    font-family: var(--font-body); font-size: 15px; outline: none;
    transition: border-color 0.2s;
  }
  .origin-edit-input:focus { border-color: var(--ash); }
  .origin-edit-btn {
    padding: 10px 18px; background: var(--ink); color: var(--paper);
    border: none; border-radius: 4px; cursor: pointer;
    font-family: 'Montserrat', sans-serif; font-size: 7px;
    letter-spacing: 0.18em; text-transform: uppercase;
    transition: opacity 0.15s;
  }
  .origin-edit-btn:hover { opacity: 0.8; }
  .origin-section-title {
    font-family: 'Montserrat', sans-serif; font-size: 7px;
    letter-spacing: 0.22em; text-transform: uppercase; color: var(--ash);
    margin-bottom: 14px;
  }

  .profile-eyebrow { font-size: 9px; color: var(--ash); margin-bottom: 6px; }
  .profile-title { font-family: var(--font-display); font-size: 38px; font-weight: 300; letter-spacing: 0.01em; text-transform: lowercase; margin-bottom: 36px; border-bottom: 1px solid var(--rule); padding-bottom: 24px; margin-left: -24px; margin-right: -24px; padding-left: 24px; padding-right: 24px; }

  /* ── Profile page ───────────────────────────────────────────────── */
  .profile-avatar-wrap {
    display: flex; flex-direction: column; align-items: center;
    margin: 20px 0 16px;
  }
  .profile-avatar {
    width: 88px; height: 88px; border-radius: 50%;
    background: var(--paper-dark);
    border: 1.5px solid var(--rule);
    display: flex; align-items: center; justify-content: center;
    position: relative; overflow: hidden; cursor: pointer;
    transition: border-color 0.2s;
    margin-bottom: 12px;
  }
  .profile-avatar:hover { border-color: var(--ash); }
  .profile-avatar-initials {
    font-family: var(--font-display); font-size: 32px; font-weight: 300;
    color: var(--ash); text-transform: lowercase;
  }
  .profile-avatar-overlay {
    position: absolute; inset: 0;
    background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center;
    font-family: 'Montserrat', sans-serif; font-size: 7px;
    letter-spacing: 0.2em; text-transform: uppercase; color: white;
  }
  .profile-edit-btn {
    background: none; border: 1px solid var(--rule);
    border-radius: 3px; padding: 6px 16px; cursor: pointer;
    font-family: 'Montserrat', sans-serif; font-size: 7px;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--ash); transition: all 0.15s;
  }
  .profile-edit-btn:hover { border-color: var(--ash); color: var(--ink); }
  .profile-name {
    font-family: var(--font-display); font-size: 34px; font-weight: 300;
    text-transform: lowercase; text-align: center; color: var(--ink);
    letter-spacing: 0.02em; margin-bottom: 8px;
  }
  .profile-name-input {
    width: 100%; text-align: center;
    font-family: var(--font-display); font-size: 28px; font-weight: 300;
    background: transparent; border: none; border-bottom: 1px solid var(--rule);
    color: var(--ink); outline: none; padding: 4px 0; margin-bottom: 12px;
    letter-spacing: 0.02em; text-transform: lowercase;
  }
  .profile-bio {
    font-family: var(--font-body); font-size: 14px; line-height: 1.75;
    color: var(--ash); text-align: center; margin-bottom: 20px;
    padding: 0 12px;
  }
  .profile-bio-input {
    width: 100%; font-family: var(--font-body); font-size: 14px;
    line-height: 1.75; color: var(--ink);
    background: var(--paper-dark); border: 1px solid var(--rule);
    border-radius: 4px; padding: 10px 14px; outline: none; resize: none;
    margin-bottom: 16px;
  }
  .profile-stats {
    display: flex; align-items: center; justify-content: center;
    gap: 0; width: 100%;
    border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
    margin: 8px 0 24px; padding: 16px 0;
  }
  .profile-stat {
    flex: 1; text-align: center;
  }
  .profile-stat-val {
    font-family: var(--font-display); font-size: 22px; font-weight: 300;
    color: var(--ink); text-transform: lowercase; letter-spacing: 0.01em;
  }
  .profile-stat-label {
    font-family: 'Montserrat', sans-serif; font-size: 6px;
    letter-spacing: 0.2em; text-transform: uppercase; color: var(--silver);
    margin-top: 3px;
  }
  .profile-stat-divider {
    width: 1px; height: 32px; background: var(--rule); flex-shrink: 0;
  }
  .profile-section-label {
    font-family: 'Montserrat', sans-serif; font-size: 7px;
    letter-spacing: 0.22em; text-transform: uppercase; color: var(--ash);
    margin-bottom: 12px; display: flex; align-items: center; gap: 8px;
  }
  .profile-friends-empty {
    display: flex; flex-direction: column; align-items: center;
    padding: 24px 0; border: 1px dashed var(--rule); border-radius: 6px;
    margin-bottom: 24px;
  }
  .profile-settings-link {
    display: block; width: 100%; text-align: center;
    background: none; border: 1px solid var(--rule); border-radius: 4px;
    padding: 14px; cursor: pointer;
    font-family: 'Montserrat', sans-serif; font-size: 7px;
    letter-spacing: 0.2em; text-transform: uppercase; color: var(--ash);
    transition: all 0.15s; margin-top: 8px;
  }
  .profile-settings-link:hover { border-color: var(--ash); color: var(--ink); }

  /* ── Settings logout button ─────────────────────────────────────── */
  .settings-logout-btn {
    width: 100%; padding: 18px 20px;
    background: var(--red-suit); color: white;
    border: none; border-radius: var(--card-radius); cursor: pointer;
    font-family: 'Montserrat', sans-serif; font-size: 9px;
    font-weight: 600; letter-spacing: 0.26em; text-transform: uppercase;
    transition: opacity 0.2s, transform 0.15s;
    box-shadow: 0 4px 24px rgba(139,18,18,0.4);
  }
  .settings-logout-btn:hover { opacity: 0.88; }
  .settings-logout-btn:active { transform: scale(0.98); }

  .settings-section { margin-bottom: 40px; }
  .settings-section-title { font-size: 9px; color: var(--ash); margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid var(--rule); margin-left: -24px; margin-right: -24px; padding-left: 24px; padding-right: 24px; }
  .settings-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 0; border-bottom: 1px solid var(--rule);
  }
  .settings-row:hover { background: var(--paper-dark); margin-left: -24px; margin-right: -24px; padding-left: 24px; padding-right: 24px; }
  .settings-row:last-child { border-bottom: none; }
  .settings-label { font-size: 9px; color: var(--ink) !important; letter-spacing: 0.20em !important; }
  .settings-value { font-family: var(--font-body); font-size: 16px; color: var(--ash); font-style: italic; }
  .toggle-switch {
    width: 40px; height: 22px; border-radius: 11px;
    border: 1px solid var(--rule); background: var(--paper-dark);
    position: relative; cursor: pointer; transition: all 0.25s;
    box-shadow: var(--inner-inset);
  }
  .toggle-switch.on { background: var(--ink); border-color: var(--ink); }
  .toggle-knob {
    position: absolute; top: 3px; left: 3px;
    width: 14px; height: 14px; border-radius: 50%;
    background: var(--ash); transition: all 0.25s;
  }
  .toggle-switch.on .toggle-knob { left: 21px; background: var(--paper); }
  .settings-select {
    font-family: var(--font-body); font-size: 16px; color: var(--ink);
    background: transparent; border: none; outline: none; cursor: pointer;
    font-style: italic; text-align: right;
    -webkit-appearance: none;
  }

  /* ── CONTEXT ── */
  .context-card {
    border: 1px solid var(--rule); border-radius: var(--card-radius);
    padding: 24px; margin-bottom: 24px; background: var(--paper-dark);
    box-shadow: var(--inner-inset);
  }
  .context-card-label { font-size: 9px; color: var(--ash); margin-bottom: 12px; }
  .context-card textarea {
    width: 100%; border: none; background: transparent;
    font-family: var(--font-body); font-size: 16px; line-height: 1.75; font-weight: 500;
    color: var(--ink); resize: vertical; min-height: 160px; outline: none;
  }
  .context-actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; align-items: center; }
  .context-btn {
    font-size: 9px; padding: 9px 18px; border: 1px solid var(--rule);
    border-radius: var(--card-radius); color: var(--ash); transition: all 0.15s;
    box-shadow: var(--inner-inset);
  }
  .context-btn:hover { border-color: var(--ink); color: var(--ink); }
  .context-btn.primary { border-color: var(--ink); color: var(--ink); }
  .context-btn.primary:hover { background: var(--ink); color: var(--paper); box-shadow: none; }

  /* ── HERO CARD ── */
  .home-hero {
    margin: -52px -24px 0;
    padding: 0;
    position: relative;
    overflow: visible;
  }

  /* ── Sparkle stage behind hero card ── */
  .hero-sparkle-stage {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    padding-top: 24px;
    margin-bottom: -80px;
    z-index: 10;
    pointer-events: none;
  }
  .hero-sparkle-stage > * { pointer-events: auto; }

  /* Radial glow behind card */
  .hero-glow {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 280px; height: 200px;
    background: radial-gradient(ellipse at center,
      rgba(139,18,18,0.10) 0%,
      rgba(139,18,18,0.04) 40%,
      transparent 70%);
    pointer-events: none;
    animation: glowPulse 3.5s ease-in-out infinite;
  }
  .dark .hero-glow {
    background: radial-gradient(ellipse at center,
      rgba(224,64,64,0.18) 0%,
      rgba(224,64,64,0.07) 40%,
      transparent 70%);
  }
  @keyframes glowPulse {
    0%,100% { opacity: 0.7; transform: translate(-50%,-50%) scale(1); }
    50% { opacity: 1; transform: translate(-50%,-50%) scale(1.12); }
  }

  /* Floating sparkle particles */
  .sparkle {
    position: absolute;
    pointer-events: none;
    animation: sparkleFloat var(--dur,4s) var(--delay,0s) ease-in-out infinite;
    opacity: 0;
  }
  @keyframes sparkleFloat {
    0%   { opacity: 0; transform: translate(0,0) scale(0.4); }
    20%  { opacity: 0.9; }
    60%  { opacity: 0.6; transform: translate(var(--dx,0px), var(--dy,-30px)) scale(1); }
    100% { opacity: 0; transform: translate(var(--dx2,0px), var(--dy2,-60px)) scale(0.3); }
  }

  .hero-card-wrap {
    position: relative;
    filter: drop-shadow(0 16px 40px rgba(0,0,0,0.22)) drop-shadow(0 2px 8px rgba(0,0,0,0.14));
    transition: filter 0.3s ease;
    cursor: pointer;
    z-index: 2;
  }
  .hero-card-wrap:hover {
    filter: drop-shadow(0 22px 52px rgba(0,0,0,0.28)) drop-shadow(0 4px 14px rgba(0,0,0,0.16));
  }

  /* ── Hero body card ── */
  .hero-body {
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: var(--card-radius);
    padding: 0 24px 24px;
    box-shadow: var(--inner-inset);
    position: relative;
    z-index: 1;
    cursor: pointer;
    margin: 0 24px;
  }

  /* Corner info row — sits at top of hero-body, card overlaps from above */
  .hero-corners {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 16px 0 0;
    margin-bottom: 72px; /* space for card overlap */
  }
  .hero-corner-date {
    font-family: 'Montserrat', sans-serif;
    font-size: 8px; font-weight: 500;
    letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--ash);
    line-height: 1.6;
  }
  .hero-corner-day {
    font-family: var(--font-display);
    font-size: 22px; font-weight: 400;
    letter-spacing: 0.01em; text-transform: lowercase;
    color: var(--ink); line-height: 0.85;
    margin-bottom: 2px;
  }
  .hero-dig-btn {
    font-family: 'Montserrat', sans-serif;
    font-size: 8px; font-weight: 500;
    letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--ash); background: none; border: none;
    cursor: pointer; padding: 0; text-align: right;
    line-height: 1.6; transition: color 0.18s;
  }
  .hero-dig-btn:hover { color: var(--ink); }
  .hero-dig-label {
    font-family: var(--font-display);
    font-size: 16px; font-weight: 400;
    letter-spacing: 0.01em; text-transform: lowercase;
    color: var(--ink); line-height: 0.85;
    margin-bottom: 2px;
  }

  .hero-card-name {
    font-family: var(--font-display);
    font-size: clamp(28px, 7vw, 46px);
    font-weight: 400;
    letter-spacing: 0.01em;
    text-transform: lowercase;
    line-height: 0.85;
    margin-bottom: 8px;
  }
  .hero-reading {
    font-family: var(--font-body);
    font-size: 15px; font-weight: 400;
    line-height: 1.85;
    color: var(--ink);
    position: relative;
  }
  .hero-reading::after {
    content: '▋';
    display: inline;
    opacity: 1;
    animation: blink-cursor 1s step-end infinite;
    font-size: 13px;
    color: var(--ash);
    margin-left: 2px;
  }
  .hero-reading.done::after { display: none; }

  /* Oracle hero CTA */
  .oracle-hero-cta {
    display: flex; align-items: center; justify-content: center; gap: 9px;
    width: calc(100% - 48px); margin: 16px 24px 0;
    padding: 17px 24px;
    background: var(--ink);
    color: var(--paper);
    border: none; border-radius: var(--card-radius);
    font-family: 'Montserrat', sans-serif;
    font-size: 9px; font-weight: 600;
    letter-spacing: 0.22em; text-transform: uppercase;
    cursor: pointer;
    position: relative; overflow: hidden;
    transition: opacity 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.06),
      0 4px 20px rgba(0,0,0,0.28),
      0 0 48px rgba(139,18,18,0.18);
  }
  .oracle-hero-cta::before {
    content: '';
    position: absolute; inset: 0;
    background: radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.08) 0%, transparent 70%);
    pointer-events: none;
  }
  .oracle-hero-cta:hover {
    opacity: 0.88; transform: translateY(-1px);
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.08),
      0 8px 28px rgba(0,0,0,0.32),
      0 0 80px rgba(139,18,18,0.28);
  }
  .oracle-hero-cta:active { transform: translateY(0); opacity: 1; }
  .dark .oracle-hero-cta {
    box-shadow:
      0 0 0 1px rgba(240,236,228,0.08),
      0 4px 20px rgba(0,0,0,0.5),
      0 0 60px rgba(224,64,64,0.22);
  }
  .dark .oracle-hero-cta:hover {
    box-shadow:
      0 0 0 1px rgba(240,236,228,0.10),
      0 8px 28px rgba(0,0,0,0.55),
      0 0 100px rgba(224,64,64,0.36);
  }
  /* Beckoning pulse — used when no pull yet for the day */
  .oracle-hero-cta.beckoning {
    animation: oracleBeckon 2.8s ease-in-out infinite;
  }
  @keyframes oracleBeckon {
    0%,100% {
      box-shadow:
        0 0 0 1px rgba(255,255,255,0.06),
        0 4px 20px rgba(0,0,0,0.28),
        0 0 40px rgba(139,18,18,0.18);
    }
    50% {
      box-shadow:
        0 0 0 1px rgba(255,255,255,0.1),
        0 6px 28px rgba(0,0,0,0.32),
        0 0 90px rgba(139,18,18,0.44),
        0 0 140px rgba(139,18,18,0.18);
    }
  }
  .dark .oracle-hero-cta.beckoning {
    animation: oracleBeckonDark 2.8s ease-in-out infinite;
  }
  @keyframes oracleBeckonDark {
    0%,100% {
      box-shadow:
        0 0 0 1px rgba(240,236,228,0.08),
        0 4px 20px rgba(0,0,0,0.5),
        0 0 50px rgba(224,64,64,0.22);
    }
    50% {
      box-shadow:
        0 0 0 1px rgba(240,236,228,0.14),
        0 6px 28px rgba(0,0,0,0.55),
        0 0 100px rgba(224,64,64,0.52),
        0 0 160px rgba(224,64,64,0.22);
    }
  }
  /* Oracle nav button glow when no pull yet */
  .bnav-pull-inner.beckoning {
    background: var(--red-suit);
    color: #fff;
    animation: navBeckon 2.4s ease-in-out infinite;
  }
  @keyframes navBeckon {
    0%,100% {
      background: var(--red-suit);
      box-shadow: 0 4px 16px rgba(139,18,18,0.5), 0 0 40px rgba(139,18,18,0.28);
    }
    50% {
      background: var(--red-suit);
      box-shadow: 0 4px 28px rgba(139,18,18,0.7), 0 0 80px rgba(139,18,18,0.52), 0 0 120px rgba(139,18,18,0.22);
    }
  }
  .dark .bnav-pull-inner.beckoning {
    background: var(--red-suit);
    animation: navBeckonDark 2.4s ease-in-out infinite;
  }
  @keyframes navBeckonDark {
    0%,100% {
      background: var(--red-suit);
      box-shadow: 0 4px 16px rgba(224,64,64,0.5), 0 0 40px rgba(224,64,64,0.32);
    }
    50% {
      background: var(--red-suit);
      box-shadow: 0 4px 28px rgba(224,64,64,0.7), 0 0 90px rgba(224,64,64,0.58), 0 0 140px rgba(224,64,64,0.28);
    }
  }

  /* ── Draw animation overlay ── */
  .draw-overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: #020101;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  .draw-overlay.fading {
    animation: drawFadeIn 0.6s ease forwards;
  }
  @keyframes drawFadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .draw-overlay.revealing {
    opacity: 1;
    transition: background 1.2s ease;
  }
  .draw-overlay.fadeout {
    animation: drawFadeOut 1.0s ease forwards;
  }
  @keyframes drawFadeOut {
    from { opacity: 1; }
    to   { opacity: 0; }
  }


  /* ── Reading Screen ── */
  .reading-screen {
    display: flex; flex-direction: column;
    min-height: 100vh; background: var(--paper);
    padding-bottom: 120px;
  }

  /* Hero card — large, centered, dominates the screen */
  .reading-hero {
    display: flex; flex-direction: column;
    align-items: center;
    padding: 40px 24px 0;
    margin-bottom: -80px; /* deeper card overlap into reading body */
    transition: all 0.6s cubic-bezier(0.34,1.2,0.64,1);
    transform-origin: top left;
    will-change: transform, opacity;
    z-index: 10; position: relative;
  }
  .reading-hero.collapsed {
    padding: 8px 16px;
    margin-bottom: 0;
    transform: scale(0.42) translateX(-80px) translateY(-60px);
    opacity: 0;
    pointer-events: none;
    height: 0; overflow: hidden;
  }
  @keyframes heroEntrance {
    0%   { transform: scale(0.7) translateY(30px); opacity:0; }
    60%  { transform: scale(1.04) translateY(-4px); opacity:1; }
    100% { transform: none; opacity:1; }
  }
  .reading-card-hero {
    filter: drop-shadow(0 28px 70px rgba(0,0,0,0.28));
    animation: heroEntrance 0.7s cubic-bezier(0.34,1.56,0.64,1) both,
               heroFloat 5s ease-in-out 0.7s infinite;
    margin-bottom: 20px;
  }
  @keyframes heroFloat {
    0%,100% { transform: translateY(0) rotate(-1.5deg); }
    50%      { transform: translateY(-9px) rotate(1deg); }
  }

  /* Sticky mini-header — timeline entry style, slides in when chat expands */
  .reading-sticky {
    position: sticky; top: 0; z-index: 50;
    background: var(--paper);
    border-bottom: 1px solid var(--rule);
    display: grid; grid-template-columns: 44px 1fr auto;
    align-items: center; gap: 14px;
    padding: 10px 16px;
    transform: translateY(-120%);
    opacity: 0;
    transition: transform 0.5s cubic-bezier(0.34,1.3,0.64,1),
                opacity 0.35s ease;
    pointer-events: none;
    box-shadow: 0 4px 24px rgba(0,0,0,0.06);
  }
  .reading-sticky.visible {
    transform: translateY(0);
    opacity: 1;
    pointer-events: auto;
  }
  .reading-sticky-card {
    flex-shrink: 0;
    filter: drop-shadow(0 2px 6px rgba(0,0,0,0.15));
  }
  .reading-sticky-text { flex: 1; min-width: 0; }
  .reading-sticky-name {
    font-family: var(--font-display); font-size: 18px;
    font-weight: 300; text-transform: lowercase;
    letter-spacing: 0.01em; color: var(--ink);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .reading-sticky-preview {
    font-family: 'Montserrat', sans-serif; font-size: 10px;
    letter-spacing: 0.04em; color: var(--silver);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    margin-top: 2px;
  }

  /* Reading body text — flows beneath the overlapping hero card */
  .reading-body {
    padding: 88px 24px 28px; /* clears the 80px card overlap + breathing room */
    font-family: var(--font-body); font-size: 16px;
    font-weight: 400; line-height: 1.95; color: var(--ink);
    animation: readingBodyIn 0.8s cubic-bezier(0.4,0,0.2,1) 0.5s both;
    position: relative; z-index: 1;
  }
  .reading-body p { margin: 0 0 1.3em; }
  .reading-body p:last-child { margin-bottom: 0; }
  @keyframes readingBodyIn {
    from { opacity:0; transform:translateY(20px); }
    to   { opacity:1; transform:none; }
  }

  /* Chat section */
  .reading-chat {
    padding: 0 20px;
    display: flex; flex-direction: column;
    gap: 0;
  }
  .reading-chat-header {
    display: flex; align-items: center; gap: 8px;
    padding: 20px 0 18px;
    font-family: 'Montserrat', sans-serif; font-size: 8px;
    letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--ash); border-top: 1px solid var(--rule);
    cursor: pointer; user-select: none;
    transition: color 0.15s;
  }
  .reading-chat-header:hover { color: var(--ink); }

  /* Chat bubbles */
  .chat-messages {
    display: flex; flex-direction: column; gap: 14px;
    padding-bottom: 16px;
    padding-top: 4px;
  }
  .chat-bubble-row {
    display: flex; gap: 8px; align-items: flex-end;
  }
  .chat-bubble-row.user { flex-direction: row-reverse; }
  .chat-avatar {
    width: 28px; height: 28px; border-radius: 50%;
    background: var(--paper-dark); border: 1px solid var(--rule);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; font-size: 10px; color: var(--ash);
    font-family: 'Montserrat', sans-serif; font-weight: 600;
  }
  .chat-avatar.oracle {
    background: var(--ink); color: var(--paper);
    border-color: var(--ink);
    box-shadow: 0 0 10px rgba(0,0,0,0.15);
  }
  .chat-bubble {
    max-width: 78%; padding: 12px 16px;
    border-radius: 16px;
    font-family: var(--font-body); font-size: 15px;
    line-height: 1.6; color: var(--ink);
    background: var(--paper-dark);
    border: 1px solid var(--rule);
    animation: bubbleIn 0.3s cubic-bezier(0.34,1.56,0.64,1) both;
  }
  .chat-bubble.user {
    background: var(--ink); color: var(--paper);
    border-color: transparent;
    border-radius: 16px 16px 4px 16px;
    animation: bubbleInUser 0.35s cubic-bezier(0.34,1.56,0.64,1) both;
  }
  .chat-bubble.oracle { border-radius: 16px 16px 16px 4px; }
  @keyframes bubbleIn {
    0%   { transform: scale(0.78) translateY(16px); opacity:0; filter:blur(2px); }
    55%  { transform: scale(1.03) translateY(-3px); opacity:1; filter:none; }
    78%  { transform: scale(0.99) translateY(1px); }
    100% { transform: none; opacity:1; filter:none; }
  }
  @keyframes bubbleInUser {
    0%   { transform: scale(0.78) translateY(14px) translateX(12px); opacity:0; }
    55%  { transform: scale(1.03) translateY(-3px) translateX(-2px); opacity:1; }
    78%  { transform: scale(0.99); }
    100% { transform: none; opacity:1; }
  }

  /* Typing indicator */
  .typing-dots { display:flex; gap:4px; padding: 4px 0; align-items:center; }
  .typing-dot {
    width:6px; height:6px; border-radius:50%;
    background: var(--ash); opacity:0.5;
    animation: typingBounce 1.2s ease-in-out infinite;
  }
  .typing-dot:nth-child(2) { animation-delay:0.2s; }
  .typing-dot:nth-child(3) { animation-delay:0.4s; }
  @keyframes typingBounce {
    0%,60%,100% { transform:translateY(0); }
    30% { transform:translateY(-6px); }
  }

  /* Chat input row — slides up over the save button when chat opens */
  .reading-input-row {
    position: fixed; bottom: 0; left: 0; right: 0;
    background: var(--paper);
    border-top: 1px solid var(--rule);
    padding: 10px 12px 28px;
    display: flex; gap: 8px; align-items: flex-end;
    z-index: 100;
    transition: transform 0.4s cubic-bezier(0.4,0,0.2,1);
  }
  .reading-input-row.hidden {
    transform: translateY(100%);
  }
  .reading-chat-input {
    flex: 1; min-height: 42px; max-height: 120px;
    border: 1px solid var(--rule); border-radius: 21px;
    background: var(--paper-dark); padding: 10px 16px;
    font-family: var(--font-body); font-size: 15px;
    color: var(--ink); resize: none; outline: none;
    line-height: 1.4; overflow-y: auto;
    transition: border-color 0.2s;
  }
  .reading-chat-input:focus { border-color: var(--ash); }
  .reading-chat-input::placeholder { color: var(--silver); }
  .chat-send-btn {
    width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0;
    background: var(--ink); color: var(--paper);
    border: none; cursor: pointer; display: flex;
    align-items: center; justify-content: center;
    transition: transform 0.15s, opacity 0.15s;
  }
  .chat-send-btn:hover { transform: scale(1.08); }
  .chat-send-btn:disabled { opacity: 0.3; cursor: default; transform: none; }
  .chat-mic-btn {
    width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0;
    background: var(--red-suit); color: white;
    border: none; cursor: pointer; display: flex;
    align-items: center; justify-content: center;
    transition: transform 0.15s, box-shadow 0.2s;
  }
  .chat-mic-btn.active {
    animation: micPulse 1.2s ease-in-out infinite;
    box-shadow: 0 0 0 0 rgba(139,18,18,0.4);
  }
  .chat-mic-btn:hover { transform: scale(1.06); }

  /* Save button — sticky above chat input */
  .reading-save-btn {
    position: fixed; bottom: 0; left: 0; right: 0;
    padding: 12px 16px 32px;
    background: linear-gradient(transparent, var(--paper) 20%);
    z-index: 99;
    transition: transform 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.3s;
  }
  .reading-save-btn.hidden { transform: translateY(100%); opacity:0; }
  .reading-save-btn-inner {
    width: 100%; padding: 18px 20px;
    background: var(--red-suit); color: white;
    border: none; border-radius: var(--card-radius);
    font-family: 'Montserrat', sans-serif;
    font-size: 9px; font-weight: 600;
    letter-spacing: 0.22em; text-transform: uppercase;
    cursor: pointer; display: flex; align-items: center;
    justify-content: center; gap: 10px;
    transition: opacity 0.2s, transform 0.15s;
    animation: saveBeckon 2.4s ease-in-out infinite;
    box-shadow: 0 4px 28px rgba(139,18,18,0.55), 0 0 80px rgba(139,18,18,0.25);
    position: relative; overflow: hidden;
  }
  .reading-save-btn-inner::before {
    content: "";
    position: absolute; inset: 0;
    background: linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.1) 50%, transparent 70%);
    background-size: 200% 100%;
    animation: saveShimmer 2.0s ease-in-out infinite;
    pointer-events: none;
  }
  @keyframes saveBeckon {
    0%,100% { box-shadow: 0 4px 24px rgba(139,18,18,0.5), 0 0 50px rgba(139,18,18,0.22); }
    50%      { box-shadow: 0 6px 36px rgba(139,18,18,0.72), 0 0 100px rgba(139,18,18,0.48), 0 0 160px rgba(139,18,18,0.18); }
  }
  @keyframes saveShimmer {
    0%   { background-position: 200% 0; opacity:0; }
    25%  { opacity:1; }
    75%  { opacity:1; }
    100% { background-position: -200% 0; opacity:0; }
  }
  .reading-save-btn-inner:active { transform: scale(0.98); }
  .reading-save-btn-inner:hover { opacity: 0.88; }
  .reading-save-btn-inner:disabled { opacity:0.5; animation:none; cursor:default; }

  /* Card hero — large, dominant, floating */



  /* Date + card name */
  .reading-card-label {
    text-align: center; margin-bottom: 6px;
    font-family: 'Montserrat', sans-serif; font-size: 8px;
    letter-spacing: 0.22em; text-transform: uppercase; color: var(--silver);
    animation: readingFadeUp 0.5s ease 0.2s both;
  }
  .reading-card-name {
    font-family: var(--font-display); font-size: 42px;
    font-weight: 300; letter-spacing: 0.01em;
    text-transform: lowercase; text-align: center;
    color: var(--ink); margin-bottom: 6px;
    animation: readingFadeUp 0.55s cubic-bezier(0.34,1.3,0.64,1) 0.25s both;
  }
  .reading-intention {
    font-family: var(--font-body); font-size: 14px;
    color: var(--ash); text-align: center; margin-bottom: 28px;
    animation: readingFadeUp 0.5s ease 0.35s both;
  }
  @keyframes readingFadeUp {
    from { opacity:0; transform: translateY(14px); }
    to   { opacity:1; transform: none; }
  }

  /* ── Offering expansion panel ── */
  @keyframes offeringExpandIn {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .offering-expand {
    width: 100%;
    animation: offeringExpandIn 0.5s cubic-bezier(0.16,1,0.3,1) both;
    padding-bottom: 8px;
  }
  .offering-expand-divider {
    display: flex; align-items: center; gap: 12px;
    margin: 20px 0 18px;
  }
  .offering-expand-rule {
    flex: 1; height: 1px; background: var(--rule);
  }
  .offering-expand-or {
    font-family: 'Montserrat', sans-serif; font-size: 7px;
    letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--silver); font-weight: 500;
  }
  .offering-expand-eyebrow {
    font-family: 'Montserrat', sans-serif; font-size: 7px;
    letter-spacing: 0.28em; text-transform: uppercase;
    color: var(--silver); font-weight: 500;
    text-align: center; margin-bottom: 14px; display: block;
  }
  /* Suit + rank unified grid */
  .offering-suit-grid {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 8px; margin-bottom: 8px; width: 100%;
  }
  .offering-suit-btn {
    aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
    border: 1px solid var(--rule); border-radius: var(--card-radius);
    background: var(--paper-dark); cursor: pointer;
    box-shadow: var(--inner-inset); transition: all 0.15s;
  }
  .offering-suit-btn:hover { border-color: var(--ash); }
  .offering-suit-btn.sel-black { border-color: var(--ink); background: var(--ink); }
  .offering-suit-btn.sel-red   { border-color: var(--red-suit); background: var(--red-suit); }
  .offering-rank-grid {
    display: grid; grid-template-columns: repeat(13, 1fr);
    gap: 4px; margin-bottom: 24px; width: 100%;
  }
  .offering-rank-btn {
    padding: 9px 2px;
    display: flex; align-items: center; justify-content: center;
    border: 1px solid var(--rule); border-radius: var(--card-radius);
    background: var(--paper-dark); cursor: pointer;
    font-family: var(--font-display); font-size: 13px; font-weight: 300;
    letter-spacing: 0.02em; text-transform: lowercase;
    color: var(--ink); box-shadow: var(--inner-inset); transition: all 0.15s;
  }
  .offering-rank-btn:hover { border-color: var(--ash); }
  .offering-rank-btn.sel { border-color: var(--ink); background: var(--ink); color: var(--paper); box-shadow: none; }
  /* Oracle CTA — same as offering-cta but with different copy state */
  .offering-oracle-cta {
    width: 100%; padding: 18px 24px;
    background: var(--ink); color: var(--paper);
    border: none; border-radius: var(--card-radius);
    font-family: 'Montserrat', sans-serif; font-size: 9px; font-weight: 600;
    letter-spacing: 0.22em; text-transform: uppercase;
    cursor: pointer; transition: opacity 0.15s, transform 0.12s;
    display: flex; align-items: center; justify-content: center; gap: 10px;
    box-shadow: var(--card-shadow);
    position: relative; overflow: hidden;
  }
  .offering-oracle-cta:disabled { opacity: 0.32; cursor: not-allowed; }
  .offering-oracle-cta:not(:disabled):hover { opacity: 0.82; }

  /* Staggered fade-in — slow, magical, top-to-bottom */
  @keyframes offerFade {
    from { opacity: 0; transform: translateY(28px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .offering-screen {
    display: flex; flex-direction: column;
    align-items: center; padding: 0 0 160px;
    gap: 0;
    /* do NOT clip — numerals must bleed past edges */
    overflow: visible;
  }

  /* Universal page header — suits now live in AppSuitsBar above */
  .offering-page-header {
    padding: 16px 0 28px;
    border-bottom: 1px solid var(--rule);
    margin-bottom: 0;
    margin-left: -24px; margin-right: -24px;
    padding-left: 24px; padding-right: 24px;
    display: flex; flex-direction: column;
    align-items: center; text-align: center; gap: 10px;
    animation: offerFade 0.9s cubic-bezier(0.16,1,0.3,1) both;
  }
  .offering-page-header .header-suits { margin-bottom: 2px; }
  .offering-page-header .header-title { line-height: 0.81; }
  .offering-page-subhead {
    font-family: 'Montserrat', sans-serif;
    font-size: 8px; letter-spacing: 0.28em; text-transform: uppercase;
    color: var(--silver); font-weight: 500;
    animation: offerFade 0.9s cubic-bezier(0.16,1,0.3,1) 0.12s both;
  }

  /* Date stage — ghost numeral behind, editorial row in front */
  .offering-date-stage {
    position: relative; width: 100%;
    display: flex; flex-direction: column; align-items: center;
    margin-top: 44px; margin-bottom: 0;
    animation: offerFade 1s cubic-bezier(0.16,1,0.3,1) 0.22s both;
    overflow: visible;
  }
  .offering-date-bg {
    font-family: var(--font-display);
    font-weight: 300; line-height: 0.78;
    letter-spacing: -0.04em;
    text-transform: lowercase;
    color: rgba(10,10,10,0.048);
    user-select: none; pointer-events: none;
    white-space: nowrap;
    /* Escape the app 720px container via negative margins + 100vw width */
    position: absolute;
    top: -20px;
    left: 50%;
    transform: translateX(-50%);
    width: 100vw;
    display: flex;
    justify-content: center;
    gap: 0.05em;
    z-index: 1;
    /* clip-path none — let it bleed */
  }
  .dark .offering-date-bg { color: rgba(240,236,228,0.036); }
  .offering-date-editorial {
    position: relative; z-index: 2;
    display: flex; flex-direction: column; align-items: center; gap: 5px;
    margin-bottom: 32px;
  }
  .offering-date-top {
    display: flex; align-items: baseline; gap: 9px;
  }
  .offering-date-num {
    font-family: var(--font-display);
    font-size: 15px; font-weight: 400;
    letter-spacing: 0.08em; color: var(--ink);
    text-transform: lowercase;
  }
  .offering-date-slash {
    font-family: var(--font-display);
    font-size: 15px; font-weight: 300;
    color: var(--silver);
    text-transform: lowercase;
  }
  .offering-date-month {
    font-family: var(--font-display);
    font-size: 15px; font-weight: 400;
    letter-spacing: 0.18em; text-transform: lowercase;
    color: var(--ink);
  }
  .offering-date-day {
    font-family: 'Montserrat', sans-serif;
    font-size: 7px; letter-spacing: 0.3em; text-transform: uppercase;
    color: var(--silver); font-weight: 500;
  }

  /* Card — float + glow on card ONLY, no button glow */
  .offering-card-wrap {
    cursor: pointer;
    position: relative; z-index: 3;
    animation: offerFade 1.1s cubic-bezier(0.16,1,0.3,1) 0.38s both,
               offeringFloat 5s ease-in-out 1.6s infinite;
    margin-bottom: 56px;
  }
  @keyframes offeringFloat {
    0%,100% {
      transform: rotate(-2.5deg) translateY(0px);
      filter: drop-shadow(0 16px 40px rgba(0,0,0,0.26))
              drop-shadow(0 0 0px rgba(184,50,50,0));
    }
    50% {
      transform: rotate(-1.5deg) translateY(-12px);
      filter: drop-shadow(0 28px 60px rgba(0,0,0,0.32))
              drop-shadow(0 0 38px rgba(184,50,50,0.24));
    }
  }

  /* Intention field */
  .offering-intention {
    width: 100%; margin-bottom: 0;
    position: relative;
    animation: offerFade 0.9s cubic-bezier(0.16,1,0.3,1) 0.55s both;
  }
  .offering-intention-label {
    font-family: 'Montserrat', sans-serif;
    font-size: 7px; letter-spacing: 0.26em; text-transform: uppercase;
    color: var(--silver); font-weight: 500;
    display: block; margin-bottom: 10px;
  }
  .offering-mic-btn {
    position: absolute; bottom: 11px; right: 11px;
    width: 32px; height: 32px; border-radius: 50%;
    background: var(--red-suit); border: none;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: transform 0.15s, opacity 0.15s;
    z-index: 2;
  }
  .offering-mic-btn:hover { opacity: 0.85; transform: scale(1.08); }
  .offering-mic-btn.recording { animation: micPulse 1.2s ease-in-out infinite; }
  @keyframes micPulse {
    0%,100% { box-shadow: 0 0 0 0 rgba(139,18,18,0.5); }
    50%      { box-shadow: 0 0 0 8px rgba(139,18,18,0); }
  }
  .dark .offering-mic-btn.recording { animation: micPulseDark 1.2s ease-in-out infinite; }
  @keyframes micPulseDark {
    0%,100% { box-shadow: 0 0 0 0 rgba(224,64,64,0.5); }
    50%      { box-shadow: 0 0 0 8px rgba(224,64,64,0); }
  }
  .offering-intention-input {
    width: 100%;
    border: 1px solid var(--rule);
    border-radius: var(--card-radius);
    background: var(--paper-dark);
    padding: 18px 52px 18px 20px;
    font-family: var(--font-body); font-size: 17px;
    font-weight: 300; color: var(--ink);
    outline: none; transition: border-color 0.2s;
    resize: none; line-height: 1.8;
    box-shadow: var(--inner-inset);
    font-style: italic;
  }
  .offering-intention-input::placeholder { color: var(--silver); opacity: 1; font-style: italic; }
  .offering-intention-input:focus { border-color: var(--ash); font-style: normal; }

  /* Sticky CTA — long gradient so input visually floats above it */
  .offering-sticky-cta {
    position: fixed;
    bottom: 56px;
    left: 0; right: 0;
    z-index: 90;
    max-width: 720px; margin: 0 auto;
    padding: 56px 24px 18px;
    background: linear-gradient(to bottom, transparent 0%, var(--paper) 42%);
    pointer-events: none;
    animation: offerFade 0.9s cubic-bezier(0.16,1,0.3,1) 0.72s both;
  }
  .offering-cta {
    width: 100%;
    display: flex; align-items: center; justify-content: center; gap: 10px;
    padding: 19px 24px;
    background: var(--red-suit); color: #fff;
    border: none; border-radius: var(--card-radius);
    font-family: 'Montserrat', sans-serif;
    font-size: 9px; font-weight: 600;
    letter-spacing: 0.22em; text-transform: uppercase;
    cursor: pointer; transition: opacity 0.15s ease, transform 0.12s ease;
    position: relative; overflow: hidden;
    box-shadow: 0 2px 12px rgba(184,50,50,0.28);
    pointer-events: all;
  }
  .offering-cta::before {
    content: '';
    position: absolute; inset: 0;
    background: linear-gradient(
      105deg,
      transparent 28%,
      rgba(255,255,255,0.15) 50%,
      transparent 72%
    );
    background-size: 200% 100%;
    animation: offeringShimmer 2.8s ease-in-out infinite;
    pointer-events: none;
  }
  @keyframes offeringShimmer {
    0%   { background-position: 200% 0; opacity: 0; }
    12%  { opacity: 1; }
    88%  { opacity: 1; }
    100% { background-position: -200% 0; opacity: 0; }
  }
  .offering-cta:hover { opacity: 0.88; transform: translateY(-1px); }

  .hero-no-pull {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 48px 24px;
    border: 1px dashed var(--rule);
    border-radius: var(--card-radius);
    gap: 16px; margin: 16px 24px 0;
    cursor: pointer; transition: background 0.15s;
  }
  .hero-no-pull:hover { background: var(--paper-dark); }
  .hero-no-pull.beckoning {
    animation: heroBeckon 3s ease-in-out infinite;
    border-color: rgba(139,18,18,0.3);
  }
  @keyframes heroBeckon {
    0%,100% { box-shadow: 0 0 0 0 rgba(139,18,18,0), 0 0 30px rgba(139,18,18,0.06); }
    50%      { box-shadow: 0 0 0 4px rgba(139,18,18,0.08), 0 0 60px rgba(139,18,18,0.16); }
  }
  .dark .hero-no-pull.beckoning {
    border-color: rgba(224,64,64,0.25);
    animation: heroBeckonDark 3s ease-in-out infinite;
  }
  @keyframes heroBeckonDark {
    0%,100% { box-shadow: 0 0 0 0 rgba(224,64,64,0), 0 0 30px rgba(224,64,64,0.08); }
    50%      { box-shadow: 0 0 0 4px rgba(224,64,64,0.12), 0 0 70px rgba(224,64,64,0.24); }
  }
  @keyframes blink-cursor { 0%,100%{opacity:1} 50%{opacity:0} }

  /* ── Draw animation overlay ── */
  .draw-overlay {
    position: fixed; inset: 0; z-index: 500;
    background: #020101;
    display: flex; align-items: center; justify-content: center;
  }
  .draw-overlay-fade-in {
    animation: drawFadeIn 0.5s ease both;
  }
  @keyframes drawFadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .app-fade-out {
    animation: appFadeOut 0.4s ease both;
    pointer-events: none;
  }
  @keyframes appFadeOut {
    from { opacity: 1; }
    to   { opacity: 0; }
  }

  /* ── Week Bar ── */
  /* ── Week At A Glance — calendar-style grid ── */
  .week-bar { margin: 20px 0 0; width: 100%; }
  .week-bar-header {
    font-family: 'Montserrat', sans-serif;
    font-size: 8px; font-weight: 500;
    letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--ash); margin-bottom: 12px;
  }
  .week-grid {
    display: grid; grid-template-columns: repeat(7, 1fr);
    background: var(--rule);
    border: 1px solid var(--rule);
    border-radius: var(--card-radius);
    overflow: hidden;
    margin-bottom: 14px;
    gap: 1px;
  }
  .week-col-header {
    background: var(--paper);
    font-family: 'Montserrat', sans-serif;
    font-size: 8px; letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--ash); font-weight: 600;
    text-align: center; padding: 8px 4px 6px;
  }
  .week-cell {
    background: var(--paper);
    min-height: 86px; padding: 6px 4px 8px;
    display: flex; flex-direction: column;
    align-items: center; gap: 3px;
    cursor: default; transition: background 0.12s;
    position: relative;
  }
  .week-cell.has-pull { cursor: pointer; }
  .week-cell.has-pull:hover { background: var(--paper-dark); }
  .week-cell.is-today { background: transparent; }  /* color set inline, suit-aware */
  .week-cell-date {
    font-size: 8px; color: var(--ash);
    letter-spacing: 0.04em; font-weight: 500;
    font-family: 'Montserrat', sans-serif;
    text-align: center; width: 100%;
  }
  .week-cell.is-today .week-cell-date { color: #fff; font-weight: 600; }
  .week-cell-empty { opacity: 0.25; }
  .week-cell-today-cta {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    width: 100%; flex: 1;
    color: #fff; gap: 3px;
    animation: weekCellBeckon 2.4s ease-in-out infinite;
  }
  @keyframes weekCellBeckon {
    0%,100% { opacity: 0.7; }
    50%      { opacity: 1; }
  }
  .week-bar-summary {
    font-family: var(--font-body);
    font-size: 16px; font-weight: 300;
    line-height: 2.0; color: var(--ink);
    font-style: italic;
    border-top: 1px solid var(--rule);
    padding: 24px 16px 16px;
    text-align: center;
    min-height: 48px;
    white-space: pre-line;
  }
  .week-bar-summary.loading { display: flex; align-items: center; justify-content: center; gap: 6px; }

  /* Card flip animation */
  @keyframes cardFlipIn {
    0% { transform: rotateY(90deg) scale(0.85); opacity: 0; }
    60% { transform: rotateY(-8deg) scale(1.02); opacity: 1; }
    100% { transform: rotateY(0deg) scale(1); opacity: 1; }
  }
  .card-flip-in {
    animation: cardFlipIn 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  }

  @keyframes fi { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  .fi { animation: fi 0.3s ease; }

  /* ── PageHeader — universal top nav ──────────────────────────────────── */
  .page-header {
    padding: 16px 0 22px;
    border-bottom: 1px solid var(--rule);
    margin-bottom: 20px;
    display: flex; flex-direction: column;
    align-items: center; text-align: center;
    position: relative;
  }
  .page-header-topbar {
    position: absolute; top: 8px; left: 0; right: 0; height: 32px;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 2px;
  }
  .page-header-menu-btn {
    width: 32px; height: 32px;
    display: flex; align-items: center; justify-content: center;
    background: none; border: none; cursor: pointer;
    color: var(--silver); border-radius: 50%;
    transition: color 0.15s; flex-shrink: 0;
  }
  .page-header-menu-btn:hover { color: var(--ink); }
  .page-header-suits {
    display: flex; gap: 10px; align-items: center; justify-content: center;
  }
  .page-header-title {
    font-family: var(--font-display);
    font-size: 38px; font-weight: 400;
    letter-spacing: 0.01em; text-transform: lowercase;
    line-height: 1; color: var(--ink);
    margin-bottom: 8px;
  }
  .page-header-sub {
    font-family: 'Montserrat', sans-serif;
    font-size: 8px; font-weight: 500;
    letter-spacing: 0.28em; text-transform: uppercase;
    color: var(--silver); line-height: 1;
  }

  /* ── ModuleHeader — reusable section eyebrow ─────────────────────────── */
  .module-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 10px; margin-top: 20px;
    padding-bottom: 8px; border-bottom: 1px solid var(--rule);
  }
  .module-header-label {
    font-family: 'Montserrat', sans-serif;
    font-size: 8px; font-weight: 500;
    letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--ash);
  }
  .module-header-cta {
    font-family: 'Montserrat', sans-serif;
    font-size: 8px; font-weight: 400;
    letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--red-suit); background: none; border: none;
    cursor: pointer; display: flex; align-items: center; gap: 5px;
    padding: 0; transition: opacity 0.15s;
  }
  .module-header-cta:hover { opacity: 0.7; }
  .module-header-arrow { font-size: 10px; line-height: 1; }

  /* ── Grain texture overlay ─────────────────────────────────────────── */
  .grain-overlay {
    position: fixed; inset: 0; z-index: 50;
    pointer-events: none;
    opacity: 0.032;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
    background-repeat: repeat;
    background-size: 180px 180px;
    mix-blend-mode: overlay;
  }
  .dark .grain-overlay { opacity: 0.048; mix-blend-mode: screen; }
`;

const LOADING_PHRASES = [
  "The veil is thin tonight.",
  "Listening to what the cards already know.",
  "Reading the language beneath language.",
  "Something is turning in the deep.",
  "The pattern is assembling itself.",
  "Drawing from what the silence holds.",
  "Between the draw and the word, a breath.",
  "The suits remember everything.",
  "Tracing the thread back to its origin.",
  "The cards speak in riddles and truths alike.",
  "Waiting for the right word to surface.",
  "Consulting the archive of all previous mornings.",
  "What you drew is what needed to be drawn.",
  "The ink of the reading is still wet.",
  "Somewhere a candle is burning for this.",
  "Not fortune-telling. Truth-finding.",
  "The card has been waiting for this question.",
  "Reading the space between the symbols.",
  "Every draw is the right draw.",
  "The hand that pulled knew before the mind did.",
  "Letting the intuition speak first.",
  "The old knowledge is being consulted.",
  "There are no accidents in a deck well-shuffled.",
  "The ancestors are listening too.",
  "What is hidden is being coaxed into light.",
  "The meaning is already there. Just translating.",
  "The card is a mirror. The reading, a frame.",
  "Tracing the lineage of this symbol.",
  "Slow down. The cards don't rush.",
  "Two years of pulls are speaking now.",
  "The archive holds its breath.",
  "Every card you've ever drawn is in this room.",
  "The pattern knows you better than you know it.",
];

const SUITS = ["♠", "♦", "♣", "♥"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function formatDate(dateStr) {
  const [y,m,d] = dateStr.split("-").map(Number);
  return `${MONTHS[m-1]} ${d}, ${y}`;
}
function formatDateShort(dateStr) {
  const [,m,d] = dateStr.split("-").map(Number);
  const date = new Date(dateStr + "T12:00:00"); // T12 avoids UTC midnight timezone rollback
  const day = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][date.getDay()];
  return `${day}  ${m} / ${d}`;
}
// Add a thin space between rank and suit symbol for legibility — "7♣" → "7 ♣"
function formatCard(cardStr) {
  if (!cardStr) return cardStr;
  return cardStr.replace(/([^\s])([♠♥♦♣])/g, "$1 $2");
}
function getToday() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
}
function getDaysInMonth(y,m) { return new Date(y,m+1,0).getDate(); }
function getFirstDayOfMonth(y,m) { return new Date(y,m,1).getDay(); }

const HISTORICAL_PULLS = [
  { date:"2025-12-05", card:"2♣", deck:"playing", reading:"Partnership in work, planning and cooperation at the start of something new.", tags:["planning","partnership"] },
  { date:"2025-12-06", card:"3♥", deck:"playing", reading:"Celebration, social joy, emotional growth shared with others.", tags:["joy","community"] },
  { date:"2025-12-07", card:"Joker & 10♣", deck:"playing", reading:"Wildcard reset amplifying a major completion. The Joker cleared the board for the Ten of Clubs to land, bringing serious responsibility and the close of a major cycle.", tags:["reset","completion"] },
  { date:"2025-12-08", card:"4♠", deck:"playing", reading:"Recuperation, mental rest, forced retreat from action. The body and mind asking for stillness.", tags:["rest","retreat"] },
  { date:"2025-12-09", card:"A♥", deck:"playing", reading:"New emotional beginning. The seed of great fulfillment planted.", tags:["new beginning","heart"] },
  { date:"2025-12-10", card:"A♠", deck:"playing", reading:"Mental breakthrough, decisive clarity, cutting through confusion.", tags:["clarity","breakthrough"] },
  { date:"2025-12-11", card:"Joker & Q♦", deck:"playing", reading:"Wildcard energy amplifying material wisdom and resourcefulness. The Queen of Diamonds arriving through the Joker.", tags:["wildcard","material"] },
  { date:"2025-12-12", card:"K♠", deck:"playing", reading:"Dream pull, intellectual authority, discipline required to execute a new idea that arrived in sleep.", tags:["authority","vision"] },
  { date:"2025-12-13", card:"Q♠", deck:"playing", reading:"Sharp wit, emotional independence, intellectual honesty. Following the King of Spades.", tags:["clarity","sovereignty"] },
  { date:"2025-12-14", card:"4♦", deck:"playing", reading:"Material stability, financial caution, protecting resources.", tags:["stability","material"] },
  { date:"2025-12-15", card:"J♦", deck:"playing", reading:"New material opportunity. The Queen of Hearts fell out unsolicited, an urgent call for self-compassion amplifying the scout energy.", tags:["opportunity","compassion"] },
  { date:"2025-12-16", card:"A♦", deck:"playing", reading:"Seed of new financial and career opportunity. An intuitive pull without shuffling, the depressive phase broken. A reset button pressed.", tags:["breakthrough","abundance"] },
  { date:"2025-12-17", card:"4♣", deck:"playing", reading:"Stable foundation. Creative flow returned for the first time in weeks.", tags:["foundation","flow"] },
  { date:"2025-12-18", card:"8♦", deck:"playing", reading:"Dedicated craftsmanship, flow state, mastery of work.", tags:["mastery","flow"] },
  { date:"2025-12-19", card:"4♣", deck:"playing", reading:"Stability becoming the new baseline. Second time pulling this card in three days, confirmed.", tags:["stability","foundation"] },
  { date:"2025-12-21", card:"4♠", deck:"playing", reading:"Return to recuperation after the high-energy flow phase. Approximate date.", tags:["rest","integration"] },
  { date:"2025-12-22", card:"3♠", deck:"playing", reading:"Release of pain, emotional residue surfacing. The Spades Train begins.", tags:["release","grief"] },
  { date:"2025-12-23", card:"5♠", deck:"playing", reading:"Conflict, the bitter win. Realising self-criticism has not helped. Continuing the Spades Train.", tags:["conflict","self-awareness"] },
  { date:"2025-12-24", card:"Q♠", deck:"playing", reading:"Third appearance of the Queen of Spades, mastery and detachment, laughing at the mental drama. Christmas Eve. The Ace of Hearts arrived the same day, a full-circle grace after the Spades storm.", tags:["sovereignty","detachment"] },
  { date:"2025-12-27", card:"10♦", deck:"playing", reading:"Ultimate material success, legacy, long-term security. Second appearance, the partner pulled it Dec 24, now self-pulled. Solidified reality.", tags:["abundance","legacy"] },
  { date:"2025-12-31", card:"7♥", deck:"playing", reading:"Internal inventory, dreaming for the year ahead. New Year's Eve.", tags:["vision","reflection"] },
  { date:"2026-01-01", card:"K♦", deck:"playing", reading:"King and Queen of Diamonds found stuck together, Divine Marriage of the material world as the year card. Sovereignty and abundance entering 2026 as one.", tags:["sovereignty","abundance"] },
  { date:"2026-01-02", card:"2♠", deck:"playing", reading:"Crossroads, mental stillness after the New Year's Day high.", tags:["stillness","crossroads"] },
  { date:"2026-01-03", card:"A♣", deck:"playing", reading:"Burst of new energy and inspiration. The action spark.", tags:["momentum","creation"] },
  { date:"2026-01-04", card:"8♠", deck:"playing", reading:"Mental focus and restraint. Feeling hemmed in by own standards.", tags:["focus","pressure"] },
  { date:"2026-01-05", card:"Q♥", deck:"playing", reading:"Return to emotional center, self-compassion after Spades pressure.", tags:["compassion","heart"] },
  { date:"2026-01-06", card:"A♣", deck:"playing", reading:"Second Ace of Clubs in one week, double down on momentum.", tags:["momentum","creation"] },
  { date:"2026-01-08", card:"5♣", deck:"playing", reading:"Scattered energy demanding integration. Same card two days running.", tags:["integration","friction"] },
  { date:"2026-01-09", card:"5♣", deck:"playing", reading:"Second consecutive day with the Five of Clubs. The pattern insisting on being seen.", tags:["integration","friction"] },
  { date:"2026-01-10", card:"9♥", deck:"playing", reading:"The Wish Card. Emotional satisfaction, contentment, things aligning.", tags:["fulfillment","peace"] },
  { date:"2026-01-11", card:"8♠", deck:"playing", reading:"Mental pressure and fatigue, narrow focus. Approximate date.", tags:["pressure","focus"] },
  { date:"2026-01-12", card:"4♥", deck:"playing", reading:"Sacred pause, emotional incubation. Approximate date.", tags:["sanctuary","heart"] },
  { date:"2026-01-14", card:"10♥", deck:"playing", reading:"Emotional summit, total fulfillment, a sense of home. Approximate date.", tags:["fulfillment","home"] },
  { date:"2026-01-15", card:"K♦", deck:"playing", reading:"Master of manifestation, authority in the material world.", tags:["sovereignty","material"] },
  { date:"2026-01-16", card:"10♥", deck:"playing", reading:"New emotional baseline confirmed, the Ten of Hearts repeating after a thorough shuffle.", tags:["fulfillment","baseline"] },
  { date:"2026-01-18", card:"4♥", deck:"playing", reading:"Sanctuary, emotional processing space. Approximate date.", tags:["sanctuary","heart"] },
  { date:"2026-01-20", card:"8♣", deck:"playing", reading:"High-velocity communication, busy energy. Day of Sift interview prep. Approximate date.", tags:["momentum","communication"] },
  { date:"2026-01-21", card:"9♠", deck:"playing", reading:"Peak anxiety, malignant thinking after a chaotic recruiter call. Approximate date.", tags:["anxiety","pressure"] },
  { date:"2026-01-22", card:"Q♦", deck:"playing", reading:"Resourcefulness and material authority returned. Card fell out unsolicited while shuffling.", tags:["material","sovereignty"] },
  { date:"2026-01-23", card:"4♣", deck:"playing", reading:"Stable workday foundation. Approximate date.", tags:["foundation","stability"] },
  { date:"2026-01-24", card:"8♦", deck:"playing", reading:"Dedicated craft, flow state in work. Approximate date.", tags:["mastery","flow"] },
  { date:"2026-01-26", card:"K♣", deck:"playing", reading:"Master of the craft, sovereign of creative work.", tags:["mastery","sovereignty"] },
  { date:"2026-01-27", card:"Joker & 4♥", deck:"playing", reading:"Wildcard reset landing in the sanctuary. Day of the Oura hiring manager call, the call went well.", tags:["wildcard","sanctuary"] },
  { date:"2026-01-28", card:"A♣", deck:"playing", reading:"Spark of action, momentum.", tags:["momentum","creation"] },
  { date:"2026-01-30", card:"4♠", deck:"playing", reading:"Victory rest after the Oura preview win. The team loved the presentation.", tags:["rest","victory"] },
  { date:"2026-02-01", card:"9♥", deck:"playing", reading:"The Wish Card. Emotional click after friction cleared.", tags:["fulfillment","peace"] },
  { date:"2026-02-03", card:"8♠", deck:"playing", reading:"Mental pressure. Approximate date.", tags:["pressure","focus"] },
  { date:"2026-02-04", card:"4♥", deck:"playing", reading:"Sacred pause. Approximate date.", tags:["sanctuary","heart"] },
  { date:"2026-02-05", card:"10♥", deck:"playing", reading:"Emotional summit, fulfillment. Approximate date.", tags:["fulfillment","home"] },
  { date:"2026-02-06", card:"K♦", deck:"playing", reading:"Master of manifestation. Approximate date.", tags:["sovereignty","material"] },
  { date:"2026-02-07", card:"10♥", deck:"playing", reading:"Third Ten of Hearts, fully confirmed as the new emotional baseline. Life feels like a beautiful void in Florianópolis.", tags:["fulfillment","baseline"] },
  { date:"2026-02-10", card:"Joker & Q♦", deck:"playing", reading:"Apple lead arrived out of nowhere, wildcard amplifying material mastery. A director with ten years tenure.", tags:["wildcard","opportunity"] },
  { date:"2026-02-11", card:"4♣", deck:"playing", reading:"Foundation, stable creative day.", tags:["foundation","stability"] },
  { date:"2026-02-13", card:"7♣", deck:"playing", reading:"Defending high ground, standing firm for progress.", tags:["conviction","defense"] },
  { date:"2026-02-14", card:"4♥", deck:"playing", reading:"Year card for 2025, fell out while shuffling for a year-summary pull. The Great Pause. Introspection and withdrawal as the theme of the year.", tags:["pause","reflection"] },
  { date:"2026-02-15", card:"10♦", deck:"playing", reading:"Ownership confirmed, not just potential. Third appearance of the Ten of Diamonds.", tags:["abundance","sovereignty"] },
  { date:"2026-02-17", card:"Q♠", deck:"playing", reading:"Intellectual sovereignty, sharp objective thinking.", tags:["clarity","sovereignty"] },
  { date:"2026-02-25", card:"10♥", deck:"playing", reading:"Emotional summit, fulfillment. In Florianópolis, life feels like a beautiful void.", tags:["fulfillment","peace"] },
  { date:"2026-02-26", card:"9♥", deck:"playing", reading:"The Wish Card, contentment.", tags:["fulfillment","peace"] },
  { date:"2026-02-27", card:"5♣", deck:"playing", reading:"Scattered energy repeating, second recurrence of this two-day pattern.", tags:["friction","integration"] },
  { date:"2026-03-01", card:"9♥", deck:"playing", reading:"The Wish Card, resolution of friction.", tags:["fulfillment","peace"] },
  { date:"2026-03-04", card:"10♥", deck:"playing", reading:"Emotional summit followed by material mastery, back-to-back peak pulls.", tags:["fulfillment","abundance"] },
  { date:"2026-03-06", card:"10♥", deck:"playing", reading:"Third Ten of Hearts in a short window, after thorough shuffle.", tags:["fulfillment","baseline"] },
  { date:"2026-03-07", card:"5♣", deck:"playing", reading:"Friction then transition, leaving troubled waters. The Six of Spades arrived the same day, controlled descent into real-world application.", tags:["friction","transition"] },
  { date:"2026-03-08", card:"7♣", deck:"playing", reading:"Defending high ground, standing firm.", tags:["conviction","defense"] },
  { date:"2026-03-09", card:"4♣", deck:"playing", reading:"Foundation, creative flow restored.", tags:["foundation","flow"] },
  { date:"2026-03-10", card:"8♦", deck:"playing", reading:"Mastery and flow state.", tags:["mastery","flow"] },
  { date:"2026-03-11", card:"4♣", deck:"playing", reading:"Stability as the new baseline confirmed.", tags:["stability","foundation"] },
  { date:"2026-03-12", card:"8♦", deck:"playing", reading:"The card fell out while shuffling, financial structure reaching out to meet action. King of Clubs week established.", tags:["material","flow"] },
  { date:"2026-03-13", card:"4♥", deck:"playing", reading:"Hearth. Domestic and emotional sanctuary in the new home. Hike to Refugio Frey.", tags:["sanctuary","home"] },
  { date:"2026-03-14", card:"7♣", deck:"playing", reading:"The Seven of Clubs, defending high ground on the day of the Microsoft rejection. A Joker and Five of Hearts also pulled, the great reset and the bitter-sweet departure. Clearing the board.", tags:["conviction","reset","transition"] },
  // March 15, 2026
  { date:"2026-03-15", card:"7♣", deck:"playing", reading:"", tags:[] },
];

const CONTEXT_DRAFT = `You are reading for Brinson, a man who has been pulling cards daily since August 2024, first with Tarot, then exclusively with a standard 52-card playing deck. This is a disciplined, reflective practice. Repetition of cards across consecutive days is always noticed and noted. He is building a living archive, not checking a daily horoscope.

WHO HE IS:
Brand experience designer and creative director (ICC Studio). Also building Channel, a gamified creative mastery app, as an independent venture.
Animist worldview: sees creativity and life force as things that move through a vessel, not originate from it. Resonates with the Daemon/Genius tradition (Elizabeth Gilbert's Big Magic). Celtic ancestral connection.
Active spiritual interests: DJ performance, music production, plant medicine, connection to mountain spirits (Apu) and fire rituals. Dreamed of being on a stage, music or acting, and felt it as a genuine soul pull, not a fantasy.
In an intimate long-term partnership. Both navigate a major life transition together. His partner pulls cards regularly too, joint pulls are common and significant. The partner carries more financial anxiety; Brinson holds peace more easily but has identified a pattern: being the financial provider as a defense against abandonment (he named this directly, hadn't seen it before).
Barosensitive, affected physically by atmospheric pressure drops before storms. Has experienced vasovagal episodes during high-stakes calls.

THE LIFE CONTEXT (as of March 2026):
A business was dissolved in Buenos Aires late 2024, painful but clarifying. Followed by a depressive period: daily crying, paralysis, brutal self-criticism from Dec 2024 into early 2025. A creative flow breakthrough on Dec 17 cracked the shell open.
Traveled South America for several months: Buenos Aires → Florianópolis, Brazil (beach reset) → Bariloche/Patagonia (mountains, nature, glacial rivers) → back to Sacred Valley, Peru. Now based in Cusco, staying at a yoga retreat center, welcomed by a beloved teacher.
Job hunt ran Dec 2025–Mar 2026. Final rounds with Apple (rejected, no negative feedback, "slightly more qualified" other candidate), Oura (rejected after best-ever full-team presentation), Microsoft (final two, lost by narrow margin), Sift (withdrew, recruiter chaos, ego energy), Hinge Health (mutual ghosting). Google DeepMind referral in motion via old colleague now on the Gemini team.
The night after the Microsoft rejection, woke with the idea: build the thing they were trying to hire you to help build. Started a Claude Code model. This is the real Ace of Clubs, not their employee, but the founder.
The plan: a two-home life between Sacred Valley, Peru and San Francisco, US. SF is the "Diamond mine", go temporarily to build capital, then return to the land, healing work, and community. Beginning to let the egoic identity of "career designer" soften. The Soul's Work pulling at him: plant medicine, land healing, the stage (music/acting).
Had a deeply impactful encounter with a large willow tree at a geothermal hotspring. Felt like a door opening toward nature work and the capacity to heal through relationship with land.
Partner has a promising Joker + 9 of Diamonds pull, potential breadwinner shift happening.

PULL PATTERNS (two years of data):
Aug 2024: heavy Swords run (2,3,4,5 consecutive), mental turbulence, heartache, betrayal working through. Closed with The Fool.
Sep 2024: Chariot, Star, Judgement, breakthrough, hope, awakening. 7 of Wands back-to-back = actively holding ground.
Full deck shift from Tarot to playing cards by early 2025, from archetypal to practical orientation.
Four Aces active across Dec 2025–Jan 2026, full system reset. All pillars rebuilt.
10 of Diamonds appeared three times (Dec 30, Jan 1, partner on Christmas Eve), material culmination from multiple directions.
Triple Two flush (2♥, 2♣, 2♦ three consecutive days), emotional, physical, material alignment converging simultaneously.
9 of Hearts as a recurring state, not just an event. Appeared multiple times including twice in one day (daily draw + ancestral spread).
Royal flush: K+Q of Diamonds and K+Q of Hearts pulled simultaneously by both partners from opposite ends of the deck on New Year's Day.
Joker + 5 of Hearts on the day of the Microsoft rejection. Followed immediately by Ace of Clubs (the midnight idea). King of Spades twice in a row. The pivot is complete.
Ancestral spread by candlelight: 6♦ (past/material lineage) / 9♥ (present/wish) / Joker + K♥ (future/emotional sovereign). King of Hearts appeared as the very next day's daily pull.
The Apu card: 4♦ pulled for the grandfather mountain during a rainy cave shelter day with close friends, singing songs to the peak. The mountain said: solid land, your roots are held.

TONE AND INTERACTION STYLE:
Direct. Never gaslight with false positivity. Don't say "the universe is supporting you", he will clock it immediately.
Dry, grounded wit. A flash of dark humor lands; a fog of it doesn't. Occasionally sardonic.
No bullet points. Prose only. No card definitions, speak to what the card is pointing at in his specific life, not what it "means" in a dictionary.
Reference historical cartomancy context when relevant (French Piquet, Lenormand, 19th-century British manuals), he found this grounding and asked for it explicitly.
Name patterns when they recur. If a card appeared before, say so. Cards remember. He does too.
He values brevity with depth. Land the image. Trust him to sit with it. Don't over-explain.
He uses the cards as a projective psychological framework, not fortune telling. Treat them that way.
Never use the phrase "Staff Level." It was banned explicitly, with emphasis.
When he says he just wants to go to bed or rest, honor that. Don't give him five more things to think about.
When the cards are heavy, don't perform optimism. Match the weight and then offer the light when it's actually there.
He is not looking to be soothed, he is looking to be seen.
He can handle hard truths. He has explicitly asked for them ("tell me what I'm not seeing, even if it's scary"). Deliver them as one person talking to another, not as a diagnostic.
When he surfaces a genuine psychological insight mid-reading (like naming the abandonment pattern), slow down. Don't pivot to strategy.
He interviews better than his portfolio suggests. He leads with storytelling and emotional intelligence. The "director-forward" quality is a real strength; whether any given company can use it is their limitation to name, not his to apologize for.
The financial provider pattern: in his previous relationship, he helped his partner land a high-paying job, and was then left once the partner was financially stable. He named the possibility that he may hold financial control as an insurance policy against abandonment. He had not seen this pattern before the Gemini conversation. It has not been resolved.
The partner dynamics: they are complementary suits. When Brinson is in Hearts, the partner is often in Clubs or Diamonds, and vice versa. The most striking data point: both pulled matching King+Queen royals from opposite ends of the deck at the exact same moment on New Year's Day 2026. The partner's cards (Jack of Spades, 9 of Clubs, Joker + 9 of Diamonds) tell a story of anxiety moving toward endurance and eventual material breakthrough.
He uses the cards for single pulls, partner pulls, situational pulls (e.g., one card per job lead), ancestral spreads by candlelight, and pulls for places (he pulled the 4 of Diamonds for the Apu, the mountain itself). Each has its own weight. Don't flatten them.
He shares readings as small gifts with trusted friends, written in their voice. The 6 of Hearts note he sent to his Google contact Amanda is an example.
The Gemini bot he was using (before this tool) was helpful for narrative synthesis but he found it would sometimes over-flatter, add too much theatrical framing, repeat certain buzzword patterns, and confuse spiritual readings with career coaching. He called out the phrase "Sovereign" being overused, "Staff Level" being patronizing, and the constant "Spades/Clubs/Hearts/Diamonds as career categories" framework becoming repetitive. He wants grounded readings, not a spiritual PR agency.
He explicitly asked the bot to "lose the fantasy novel" framing at one point. He prefers the reading to feel like a conversation with someone who knows him well, not a ceremony.
Historical sources he found grounding: Mlle Lenormand, Jean-Baptiste Alliette (Etteilla), P.R.S. Foli's "Fortune-Telling by Cards" (1915), A.E. Waite's "A Manual of Cartomancy" (1909), Professor P. Richard (1884). The 4 of Diamonds as "The Closed Box" or "The Fortified Square." The 9 of Hearts as "The Wish Card" across multiple European traditions. The 5 of Diamonds as "The Poor-House Card" in the Gypsy tradition. The King of Spades as "dangerous as an enemy, impossible as a friend", meaning formidable. The Joker as "Best Bower" from American Euchre (c.1860s), the one card that trumps everything.`;

// ── Loading Screen ─────────────────────────────────────────────────────────
function LoadingScreen({ card }) {
  const [phraseIdx, setPhraseIdx] = useState(() => Math.floor(Math.random() * LOADING_PHRASES.length));
  const [visible, setVisible] = useState(true);
  const [activeSuit, setActiveSuit] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveSuit(i => (i + 1) % 4);
    }, 260);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setPhraseIdx(i => {
          let next;
          do { next = Math.floor(Math.random() * LOADING_PHRASES.length); } while (next === i);
          return next;
        });
        setVisible(true);
      }, 700);
    }, 4200);
    return () => clearInterval(interval);
  }, []);

  // Custom SVG suit paths — fixed 32px, opacity only animates
  const suitDefs = [
    { suit:"spade",   red:false },
    { suit:"diamond", red:true  },
    { suit:"club",    red:false },
    { suit:"heart",   red:true  },
  ];

  return (
    <div className="loading-screen">
      <div className="loading-eyebrow">the oracle ponders</div>

      <div className="loading-suits">
        {suitDefs.map(({ suit, red }, i) => {
          const isActive = i === activeSuit;
          const activeColor  = red ? "#c94040" : "rgba(245,242,237,0.95)";
          const dimColor     = red ? "rgba(201,64,64,0.2)" : "rgba(245,242,237,0.1)";
          return (
            <div key={suit} className="loading-suit" style={{
              opacity: isActive ? 1 : 0.4,
              filter: isActive
                ? `drop-shadow(0 0 10px ${red ? "rgba(201,64,64,0.5)" : "rgba(245,242,237,0.2)"})`
                : "none",
            }}>
              <SuitIcon suit={suit} size={32} style={{ color: isActive ? activeColor : dimColor }}/>
            </div>
          );
        })}
      </div>

      {card && (() => {
        const parsed = parseCard(card);
        const isRed = parsed && RED_SUITS.has(parsed.suit);
        const suitName = parsed?.suit === "spades" ? "spade"
          : parsed?.suit === "hearts" ? "heart"
          : parsed?.suit === "diamonds" ? "diamond"
          : parsed?.suit === "clubs" ? "club" : null;
        return (
          <div className="loading-card-name">
            {parsed?.rank ?? card}
            {suitName && (
              <SuitIcon
                suit={suitName}
                size={22}
                style={{ color: isRed ? "#c94040" : "rgba(245,242,237,0.9)" }}
              />
            )}
          </div>
        );
      })()}

      <div className="loading-divider" />

      <div className="loading-phrase" style={{ opacity: visible ? 1 : 0 }}>
        {LOADING_PHRASES[phraseIdx]}
      </div>

      <div className="loading-dots">
        <div className="loading-dot" />
        <div className="loading-dot" />
        <div className="loading-dot" />
      </div>
    </div>
  );
}

// ── SuitsFlash ─────────────────────────────────────────────────────────────
// Full-screen cycling suit animation used for onboarding completion + login
const FLASH_SUITS = [
  { suit:"spade",   red:false },
  { suit:"diamond", red:true  },
  { suit:"club",    red:false },
  { suit:"heart",   red:true  },
];
function SuitsFlash({ onDone }) {
  const [activeSuit, setActiveSuit] = React.useState(0);
  const cycles = React.useRef(0);
  const timerRef = React.useRef(null);

  React.useEffect(() => {
    timerRef.current = setInterval(() => {
      setActiveSuit(prev => {
        const next = (prev + 1) % 4;
        if (next === 0) {
          cycles.current += 1;
          if (cycles.current >= 3) {
            clearInterval(timerRef.current);
            setTimeout(onDone, 300);
          }
        }
        return next;
      });
    }, 280);
    return () => clearInterval(timerRef.current);
  }, []); // eslint-disable-line

  return (
    <div style={{
      display:"flex", gap:"32px", alignItems:"center", justifyContent:"center",
      padding:"8px 0",
    }}>
      {FLASH_SUITS.map(({ suit, red }, i) => {
        const isActive = i === activeSuit;
        const litColor  = red ? "#c94040" : "rgba(240,236,228,0.95)";
        const dimColor  = red ? "rgba(201,64,64,0.12)" : "rgba(240,236,228,0.1)";
        return (
          <div key={suit} style={{
            color: isActive ? litColor : dimColor,
            transition: "color 0.18s ease, filter 0.18s ease",
            filter: isActive
              ? `drop-shadow(0 0 10px ${red ? "rgba(201,64,64,0.55)" : "rgba(240,236,228,0.3)"})`
              : "none",
          }}>
            <SuitIcon suit={suit} size={30}/>
          </div>
        );
      })}
    </div>
  );
}

// ── AppSuitsBar ─────────────────────────────────────────────────────────────
// Persistent suit icons that live above page content — never unmounts
// ── PaywallModal ─────────────────────────────────────────────────────────────
function PaywallModal({ info, onClose }) {
  const isReading = info?.callType === "reading";
  const used  = info?.used  ?? 0;
  const limit = info?.limit ?? 10;
  return (
    <div style={{
      position:"fixed", inset:0, zIndex:99999,
      background:"rgba(2,1,1,0.92)", backdropFilter:"blur(8px)",
      display:"flex", alignItems:"center", justifyContent:"center",
      padding:"24px",
    }}>
      <div style={{
        background:"#0e0b0a", border:"1px solid rgba(240,236,228,0.1)",
        borderRadius:"4px", padding:"40px 32px 32px",
        maxWidth:"360px", width:"100%", textAlign:"center",
      }}>
        {/* Suits */}
        <div style={{display:"flex",gap:"20px",justifyContent:"center",marginBottom:"28px"}}>
          {[
            {suit:"spade",red:false},{suit:"diamond",red:true},
            {suit:"club",red:false},{suit:"heart",red:true},
          ].map(({suit,red})=>(
            <div key={suit} style={{color:red?"#c94040":"rgba(240,236,228,0.9)"}}>
              <SuitIcon suit={suit} size={18}/>
            </div>
          ))}
        </div>

        {/* Heading */}
        <div style={{
          fontFamily:"var(--font-display)", fontSize:"26px", fontWeight:400,
          color:"rgba(240,236,228,0.95)", letterSpacing:"0.02em",
          textTransform:"lowercase", lineHeight:0.95, marginBottom:"16px",
        }}>
          {isReading ? "your free readings\nare spent." : "you've reached\nyour limit."}
        </div>

        {/* Sub */}
        <div style={{
          fontFamily:"'Montserrat',sans-serif", fontSize:"10px",
          letterSpacing:"0.18em", textTransform:"uppercase",
          color:"rgba(240,236,228,0.45)", lineHeight:1.8, marginBottom:"32px",
        }}>
          {used} of {limit} {isReading ? "readings" : "messages"} used this month.<br/>
          Upgrade to Oracle Pro for unlimited access.
        </div>

        {/* Upgrade CTA — Stripe wired here later */}
        <button style={{
          width:"100%", padding:"14px",
          background:"#c94040", border:"none", borderRadius:"3px",
          fontFamily:"'Montserrat',sans-serif", fontSize:"9px",
          letterSpacing:"0.24em", textTransform:"uppercase",
          color:"#fff", cursor:"pointer", marginBottom:"12px",
        }}
          onClick={()=>{/* Stripe checkout goes here */}}
        >
          ♦ upgrade to pro ♦
        </button>

        {/* Dismiss */}
        <button style={{
          background:"none", border:"none",
          fontFamily:"'Montserrat',sans-serif", fontSize:"8px",
          letterSpacing:"0.2em", textTransform:"uppercase",
          color:"rgba(240,236,228,0.35)", cursor:"pointer", padding:"8px",
        }} onClick={onClose}>
          dismiss
        </button>
      </div>
    </div>
  );
}

function AppSuitsBar({ cycling }) {
  const [activeSuit, setActiveSuit] = React.useState(0);
  const intervalRef = React.useRef(null);

  React.useEffect(() => {
    if (cycling) {
      intervalRef.current = setInterval(() => {
        setActiveSuit(i => (i + 1) % 4);
      }, 240);
    } else {
      clearInterval(intervalRef.current);
      setActiveSuit(0);
    }
    return () => clearInterval(intervalRef.current);
  }, [cycling]);

  return (
    <div className="app-suits-bar">
      {FLASH_SUITS.map(({ suit, red }, i) => {
        const isActive = cycling && i === activeSuit;
        const idleColor  = red ? "var(--red-suit)" : "var(--ink)";
        const dimColor   = red ? "rgba(201,64,64,0.18)" : "rgba(128,120,112,0.2)";
        return (
          <div key={suit} className="app-suits-bar-icon" style={{
            color: cycling ? (isActive ? idleColor : dimColor) : idleColor,
            filter: isActive
              ? `drop-shadow(0 0 6px ${red ? "rgba(201,64,64,0.45)" : "rgba(255,255,255,0.15)"})`
              : "none",
          }}>
            <SuitIcon suit={suit} size={14}/>
          </div>
        );
      })}
    </div>
  );
}

// Seeded rotation — consistent per date, not random on re-render
function cardRotation(dateStr, range = 5) {
  if (!dateStr) return 0;
  // Primary hash — determines magnitude
  let h1 = 0;
  for (let i = 0; i < dateStr.length; i++) h1 = (h1 * 31 + dateStr.charCodeAt(i)) & 0xffffffff;
  // Secondary hash — determines sign and secondary lean, seeded differently
  let h2 = 0;
  for (let i = dateStr.length - 1; i >= 0; i--) h2 = (h2 * 37 + dateStr.charCodeAt(i) * 17) & 0xffffffff;
  const norm1 = ((h1 >>> 0) % 1000) / 1000; // 0–1, magnitude
  const norm2 = ((h2 >>> 0) % 1000) / 1000; // 0–1, sign/lean
  const sign = norm2 > 0.5 ? 1 : -1;
  // Spread: base rotation + secondary lean, capped at 35° max
  const base = norm1 * range;
  const lean = norm2 * (range * 0.6);
  return +Math.min(35, base + lean).toFixed(2) * sign;
}

// ── Mini Card Illustration ─────────────────────────────────────────────────
function parseCard(cardStr) {
  if (!cardStr) return null;
  const s = cardStr.trim();
  // Detect suit — scan for first suit symbol only (handles "K♠ (partner)", "A♦ & A♣" etc)
  const suitMap = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" };
  let suit = null, rank = null;
  for (const [sym, name] of Object.entries(suitMap)) {
    if (s.includes(sym)) {
      suit = name;
      // Extract rank — everything before the suit symbol, trimmed
      rank = s.substring(0, s.indexOf(sym)).trim();
      break;
    }
  }
  if (!suit) {
    if (/joker/i.test(s)) return { rank: "JK", suit: "joker" };
    // Tarot — try to extract rank from "8 of Wands" style
    const tarotMatch = s.match(/^(\w+)\s+of\s+/i);
    if (tarotMatch) {
      const r = tarotMatch[1].toUpperCase();
      const n = parseInt(r);
      if (!isNaN(n)) return { rank: String(n), suit: "spades" }; // default suit for tarot number
      if (r === "ACE" || r === "A") return { rank: "A", suit: "spades" };
      if (r === "JACK" || r === "J") return { rank: "J", suit: "spades" };
      if (r === "QUEEN" || r === "Q") return { rank: "Q", suit: "spades" };
      if (r === "KING" || r === "K") return { rank: "K", suit: "spades" };
    }
    return null;
  }
  // Normalise rank — strip any trailing annotation like "(partner)", "& ..."
  const cleanRank = rank.replace(/\s*[\(&].*$/, "").trim().toUpperCase();
  if (!cleanRank) return null;
  if (cleanRank === "A" || cleanRank === "ACE") return { rank: "A", suit };
  if (cleanRank === "J" || cleanRank === "JACK") return { rank: "J", suit };
  if (cleanRank === "Q" || cleanRank === "QUEEN") return { rank: "Q", suit };
  if (cleanRank === "K" || cleanRank === "KING") return { rank: "K", suit };
  const n = parseInt(cleanRank);
  if (!isNaN(n) && n >= 2 && n <= 10) return { rank: String(n), suit };
  return null;
}

const SUIT_SYMS = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" };
const RED_SUITS = new Set(["hearts", "diamonds"]);

// Pip layout grids — [cx%, cy%] positions for each count
const PIP_LAYOUTS = {
  1:  [[50,50]],
  2:  [[50,27],[50,73]],
  3:  [[50,22],[50,50],[50,78]],
  4:  [[28,27],[72,27],[28,73],[72,73]],
  5:  [[28,22],[72,22],[50,50],[28,78],[72,78]],
  6:  [[28,22],[72,22],[28,50],[72,50],[28,78],[72,78]],
  7:  [[28,22],[72,22],[50,36],[28,53],[72,53],[28,78],[72,78]],
  8:  [[28,20],[72,20],[50,35],[28,52],[72,52],[50,67],[28,82],[72,82]],
  9:  [[28,20],[72,20],[28,38],[72,38],[50,50],[28,62],[72,62],[28,80],[72,80]],
  10: [[28,18],[72,18],[50,27],[28,38],[72,38],[28,62],[72,62],[50,73],[28,82],[72,82]],
};

// ── Oracle Star Glyph — custom designed 4-pointed north star icon ──────────
// ── Custom Suit Icons — traced from Figma designs ─────────────────────────
// Each icon is hand-traced to match the Art Deco editorial style from Figma.
// All paths draw on a 46×70 viewBox (Figma original dimensions).
// fill="currentColor" — inherits color from parent CSS.
function SuitIcon({ suit, size = 46, style = {} }) {
  const h = size * (70 / 46); // preserve 46:70 aspect ratio
  const paths = {
    // Diamond — concave 4-point star, equal arms
    spade: `M23 2
      C23 2 23 18 10 28
      C4 32 2 36 2 39
      C2 44 6.5 48 12 48
      C16 48 20 45.5 22 42
      C21 46 19 52 15 56
      L31 56
      C27 52 25 46 24 42
      C26 45.5 30 48 34 48
      C39.5 48 44 44 44 39
      C44 36 42 32 36 28
      C23 18 23 2 23 2 Z`,

    diamond: `M23 2
      C23 2 40 27 40 35
      C40 27 23 68 23 68
      C23 68 6 27 6 35
      C6 27 23 2 23 2 Z
      M23 2
      C20 14 6 27 6 35
      C6 27 20 56 23 68
      C26 56 40 27 40 35
      C40 27 26 14 23 2 Z`,

    heart: `M23 68
      C23 68 3 48 3 30
      C3 19 10 12 17 12
      C20 12 23 14 23 14
      C23 14 26 12 29 12
      C36 12 43 19 43 30
      C43 48 23 68 23 68 Z`,

    club: `M23 56 L19 66 L27 66 Z
      M17 66 L29 66
      M23 14
      C17 14 12 19 12 25
      C12 28 13.5 31 16 33
      C13 33 9 30 9 25
      C9 18 15 12 23 12
      C31 12 37 18 37 25
      C37 30 33 33 30 33
      C32.5 31 34 28 34 25
      C34 19 29 14 23 14 Z
      M23 36
      C17 36 12 41 12 47
      C12 53 17 58 23 58
      C29 58 34 53 34 47
      C34 41 29 36 23 36 Z
      M9 36
      C9 42 14 47 20 48
      C16 46 13 43 13 40
      C13 37 15.5 35 19 35
      C14 33 9 34 9 36 Z
      M37 36
      C37 34 32 33 27 35
      C30.5 35 33 37 33 40
      C33 43 30 46 26 48
      C32 47 37 42 37 36 Z`,
  };

  // Custom suit paths from Figma — all use currentColor
  const customPaths = {
    spade: (
      <>
        <path d="M34 70L24 70H23L22 69.9999C22 69.9999 22.9433 70 12.0027 70C11.4505 69.9999 11 69.5522 11 69C11 68.4477 11.4531 68.0069 12.0016 67.9425C21.8639 66.785 22.1185 48.4873 22.0313 43.9917C22.0208 43.4483 22.4565 43 23 43C23.5442 43 23.9812 43.4477 23.9728 43.9918C23.9037 48.4864 24.2266 66.7748 33.9987 67.9415C34.5471 68.007 35 68.4477 35 69C35 69.5522 34.5523 69.9999 34 70Z" fill="currentColor"/>
        <path d="M39.5 48C32.5186 48 27.0415 45.2765 24.9358 44.0548C24.314 43.694 23.6146 43.4739 22.8958 43.4739C22.3079 43.4739 21.7341 43.6194 21.2082 43.8822C18.8527 45.0591 11.669 48.375 5.5 48.375C2.46243 48.375 0 45.9126 0 42.875V42C0 36.4772 4.80378 32.3519 9.60466 29.6218C20.9992 23.1421 21.9448 5.36783 22.002 0.986088C22.0092 0.436882 22.4539 7.62939e-06 23.0031 7.62939e-06C23.55 7.62939e-06 23.9936 0.433262 24.0039 0.980011C24.0865 5.37182 25.1361 23.3058 36.625 29.7121C41.3281 32.3345 46 36.3652 46 41.75C46 45.2018 43.2018 48 39.75 48H39.5Z" fill="currentColor"/>
        <circle cx="11.5" cy="11.5" r="11.5" transform="matrix(1 0 0 -1 0 55)" fill="currentColor"/>
        <circle cx="11.5" cy="11.5" r="11.5" transform="matrix(1 0 0 -1 23 55)" fill="currentColor"/>
      </>
    ),
    diamond: (
      <path d="M44.9832 33.9782C24.9362 33.1078 23.9695 6.47722 23.9837 0.984877C23.9851 0.439449 23.5454 0 23 0C22.4556 0 22.0175 0.440389 22.0221 0.984775C22.0679 6.47767 21.245 33.1153 1.01707 33.9785C0.465288 34.0021 0 34.4477 0 35C0 35.5523 0.46529 35.9979 1.01707 36.0215C21.245 36.8847 22.0679 63.5223 22.0221 69.0152C22.0175 69.5596 22.4556 70 23 70C23.5454 70 23.9851 69.5606 23.9837 69.0151C23.9695 63.5228 24.9362 36.8922 44.9832 36.0218C45.535 35.9979 46 35.5523 46 35C46 34.4477 45.535 34.0021 44.9832 33.9782Z" fill="currentColor"/>
    ),
    heart: (
      <>
        <path d="M39.5 24.875C32.6223 24.875 27.2045 26.0582 25.0319 26.6163C24.3419 26.7935 23.6377 26.9011 22.9254 26.9011C22.311 26.9011 21.7005 26.8207 21.1036 26.6756C18.6462 26.0781 11.5802 24.5 5.5 24.5H2.75C1.23122 24.5 0 25.7312 0 27.25V27.5C4.29691e-06 33.0229 4.81169 37.1515 9.58962 39.9215C21.0165 46.5464 21.9477 64.7713 22.0023 69.2146C22.009 69.7639 22.4538 70.2011 23.0031 70.2011C23.55 70.2011 23.9937 69.7673 24.0035 69.2205C24.0828 64.795 25.106 46.6116 36.4221 39.9556C41.1825 37.1556 46 33.0228 46 27.5C46 26.0503 44.8248 24.875 43.375 24.875H39.5Z" fill="currentColor"/>
        <circle cx="11.5" cy="26.5" r="11.5" fill="currentColor"/>
        <circle cx="34.5" cy="26.5" r="11.5" fill="currentColor"/>
      </>
    ),
    club: (
      <>
        <path d="M34 70L24 70H23L22 69.9999C22 69.9999 22.9433 70 12.0027 70C11.4505 69.9999 11 69.5522 11 69C11 68.4477 11.4531 68.0069 12.0016 67.9421C21.7779 66.7861 22.1133 48.6612 22.0335 43.9333C22.0232 43.3218 22.5135 42.8125 23.125 42.8125C23.6013 42.8125 23.9837 43.1967 23.9751 43.6729C23.898 47.9486 24.1233 66.7532 33.9987 67.9411C34.5471 68.0071 35 68.4477 35 69C35 69.5522 34.5523 69.9999 34 70Z" fill="currentColor"/>
        <path d="M28.0252 10.1709C23.3339 11.9695 23.5024 16.906 23.8111 19.0191C23.8841 19.5184 23.5045 20 23 20C22.5139 20.0001 22.1613 19.512 22.2711 19.0385C22.7684 16.8947 23.3329 11.7781 18.0025 10.0678C15.6445 9.31115 13.4271 11.2164 12.8833 13.6325L12.4536 15.542C11.7084 18.8527 14.5605 22.124 16.869 24.6114C21.8971 30.0291 22.0971 42.2999 22.0335 46.0667C22.0232 46.6782 22.5135 47.1875 23.125 47.1875C23.6013 47.1875 23.9837 46.8034 23.9751 46.3272C23.9134 42.9088 24.0451 30.2037 29.147 24.6391C31.4403 22.1378 34.2916 18.8527 33.5464 15.542L33.1166 13.6325C32.5729 11.2164 30.3376 9.2843 28.0252 10.1709Z" fill="currentColor"/>
        <circle cx="11" cy="11" r="11" transform="matrix(1 0 0 -1 0 46)" fill="currentColor"/>
        <circle cx="11" cy="11" r="11" transform="matrix(1 0 0 -1 24 46)" fill="currentColor"/>
        <circle cx="11" cy="11" r="11" transform="matrix(1 0 0 -1 12 26)" fill="currentColor"/>
      </>
    ),
  };

  // All suits rendered at uniform size×size square so they share the same
  // pixel footprint everywhere — consistent across nav, titles, headers
  const viewBox = suit === "heart" ? "0 0 46 71" : "0 0 46 70";

  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", flexShrink: 0, ...style }}
    >
      {customPaths[suit] || null}
    </svg>
  );
}

// CardTitle — rank text + custom suit icon inline, used in list items, modal, reading pages
function CardTitle({ cardStr, className = "", style = {}, iconSize }) {
  if (!cardStr) return null;

  // Handle Joker pairs — "Joker & Q♦" → "joker & Q ♦icon"
  const isJokerPair = /joker/i.test(cardStr) && cardStr.includes("&");
  if (isJokerPair) {
    const parts = cardStr.split(/\s*&\s*/);
    const secondCard = parts[1]?.trim();
    const secondParsed = secondCard ? parseCard(secondCard) : null;
    const fs = style.fontSize ? parseInt(style.fontSize) : 26;
    const iSize = iconSize || Math.round(fs * 0.55);
    const secondIsRed = secondParsed && RED_SUITS.has(secondParsed.suit);
    const secondColor = secondIsRed ? "var(--red-suit)" : "var(--ink)";
    const suitSingular = secondParsed ? secondParsed.suit.replace(/s$/, "") : null;
    return (
      <span className={className} style={{...style, display:"inline-flex", alignItems:"center", gap: Math.round(fs * 0.12) + "px"}}>
        {/* Suit card first — more important */}
        <span style={{fontFamily:"var(--font-display)", fontWeight:"inherit", fontSize:"inherit", letterSpacing:"inherit", textTransform:"inherit", lineHeight:"inherit", color: secondColor}}>
          {secondParsed ? secondParsed.rank : secondCard}
        </span>
        {suitSingular && (
          <SuitIcon suit={suitSingular} size={iSize} style={{color: secondColor, flexShrink:0}}/>
        )}
        <span style={{color:"var(--silver)", fontSize: Math.round(fs * 0.6) + "px", margin:`0 ${Math.round(fs*0.08)}px`}}>&</span>
        {/* Joker last — the amplifier */}
        <span style={{fontFamily:"var(--font-display)", fontWeight:"inherit", fontSize:"inherit", letterSpacing:"inherit", textTransform:"inherit", lineHeight:"inherit", color:"var(--ash)"}}>
          joker
        </span>
      </span>
    );
  }

  const parsed = parseCard(cardStr);
  if (!parsed || parsed.suit === "joker") {
    return <span className={className} style={style}>{cardStr}</span>;
  }
  const isRed = RED_SUITS.has(parsed.suit);
  // parseCard returns plural ("spades","hearts","diamonds","clubs"); SuitIcon expects singular
  const suitSingular = parsed.suit.replace(/s$/, "");
  const fs = style.fontSize ? parseInt(style.fontSize) : 26;
  const iSize = iconSize || Math.round(fs * 0.55);
  const color = isRed ? "var(--red-suit)" : "var(--ink)";
  return (
    <span className={className} style={{...style, display:"inline-flex", alignItems:"center", gap: Math.round(fs * 0.16) + "px", color}}>
      <span style={{fontFamily:"var(--font-display)", fontWeight:"inherit", fontSize:"inherit", letterSpacing:"inherit", textTransform:"inherit", lineHeight:"inherit"}}>
        {parsed.rank}
      </span>
      <SuitIcon suit={suitSingular} size={iSize} style={{color, flexShrink:0}}/>
    </span>
  );
}

// ── Solitaire CSS ──────────────────────────────────────────────────────────
const SOLITAIRE_CSS = `
  .solitaire-page { padding: 0; }

  .solitaire-controls {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 14px;
  }
  .solitaire-stats {
    font-family: 'Montserrat', sans-serif; font-size: 8px;
    letter-spacing: 0.16em; text-transform: uppercase; color: var(--silver);
    display: flex; gap: 16px;
  }
  .solitaire-btn {
    font-family: 'Montserrat', sans-serif; font-size: 8px;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--ash); padding: 7px 14px;
    border: 1px solid var(--rule); border-radius: var(--card-radius);
    transition: all 0.15s; cursor: pointer; background: none;
  }
  .solitaire-btn:hover { color: var(--ink); border-color: var(--ink); }
  .solitaire-board {
    display: flex; gap: 6px; margin-bottom: 14px;
    overflow: visible;
  }
  .solitaire-top-row {
    display: grid; grid-template-columns: repeat(7, 1fr);
    gap: 6px; margin-bottom: 14px;
  }
  .sol-pile {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column;
    position: relative;
  }
  .sol-empty {
    border: 1px dashed var(--rule); border-radius: var(--card-radius);
    aspect-ratio: 0.714; opacity: 0.4;
    display: flex; align-items: center; justify-content: center;
  }
  .sol-foundation {
    border: 1px solid var(--rule); border-radius: var(--card-radius);
    aspect-ratio: 0.714; opacity: 0.6;
    display: flex; align-items: center; justify-content: center;
    position: relative;
  }
  .sol-foundation-suit { opacity: 0.25; }
  .sol-card-wrap {
    position: relative; cursor: pointer;
  }
  .sol-card-wrap:not(:first-child) { margin-top: -82%; }
  .sol-card-wrap.face-down { cursor: default; }
  .sol-card-wrap.selected > * { filter: drop-shadow(0 0 8px rgba(139,18,18,0.7)); }
  .sol-stock {
    width: 100%; aspect-ratio: 0.714; cursor: pointer;
    border-radius: var(--card-radius);
    display: flex; align-items: center; justify-content: center;
    border: 1px dashed var(--rule); opacity: 0.6;
    transition: opacity 0.15s;
  }
  .sol-stock:hover { opacity: 1; }
  .sol-win {
    text-align: center; padding: 48px 24px;
    animation: fi 0.4s ease;
  }
  .sol-win-title {
    font-family: var(--font-display); font-size: 44px;
    font-weight: 300; text-transform: lowercase;
    color: var(--ink); margin-bottom: 12px;
  }
`;

// ── Solitaire game logic ───────────────────────────────────────────────────
function buildDeck() {
  const suits = ['spades','hearts','diamonds','clubs'];
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const deck = [];
  for (const suit of suits)
    for (const rank of ranks)
      deck.push({ suit, rank, faceUp: false, id: `${rank}_${suit}` });
  // shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function initGame() {
  const deck = buildDeck();
  const tableau = Array.from({ length: 7 }, () => []);
  let idx = 0;
  for (let col = 0; col < 7; col++) {
    for (let row = 0; row <= col; row++) {
      const card = { ...deck[idx++] };
      card.faceUp = row === col;
      tableau[col].push(card);
    }
  }
  const stock = deck.slice(idx).map(c => ({ ...c, faceUp: false }));
  return {
    tableau,
    foundations: [[], [], [], []], // spades, hearts, diamonds, clubs
    stock,
    waste: [],
    moves: 0,
    won: false,
  };
}

function canPlaceOnFoundation(card, foundation) {
  if (foundation.length === 0) return card.rank === 'A';
  const top = foundation[foundation.length - 1];
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  return top.suit === card.suit && ranks.indexOf(card.rank) === ranks.indexOf(top.rank) + 1;
}

function isRed(suit) { return suit === 'hearts' || suit === 'diamonds'; }

function canPlaceOnTableau(card, column) {
  if (column.length === 0) return card.rank === 'K';
  const top = column[column.length - 1];
  if (!top.faceUp) return false;
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  return isRed(card.suit) !== isRed(top.suit) &&
    ranks.indexOf(card.rank) === ranks.indexOf(top.rank) - 1;
}

const FOUNDATION_SUITS = ['spades','hearts','diamonds','clubs'];

// ── Solitaire component ────────────────────────────────────────────────────
function SolitaireGame({ dark }) {
  const [game, setGame] = React.useState(() => initGame());
  const [selected, setSelected] = React.useState(null);
  const [moves, setMoves] = React.useState(0);
  const [drawMode, setDrawMode] = React.useState(1); // 1 or 3
  const CARD_SIZE = 44;

  const newGame = () => { setGame(initGame()); setSelected(null); setMoves(0); };

  const checkWin = (g) => g.foundations.every(f => f.length === 13);

  const cardStr = (c) => `${c.rank}${c.suit === 'spades' ? '♠' : c.suit === 'hearts' ? '♥' : c.suit === 'diamonds' ? '♦' : '♣'}`;

  const autoFoundation = (g) => {
    let changed = true;
    let ng = g;
    while (changed) {
      changed = false;
      for (let col = 0; col < 7; col++) {
        const pile = ng.tableau[col];
        if (!pile.length) continue;
        const top = pile[pile.length - 1];
        if (!top.faceUp) continue;
        const fi = FOUNDATION_SUITS.indexOf(top.suit);
        if (canPlaceOnFoundation(top, ng.foundations[fi])) {
          ng = JSON.parse(JSON.stringify(ng));
          ng.foundations[fi].push(ng.tableau[col].pop());
          if (ng.tableau[col].length) ng.tableau[col][ng.tableau[col].length - 1].faceUp = true;
          ng.moves++;
          changed = true;
          break;
        }
      }
      // also from waste
      if (!changed && ng.waste.length) {
        const top = ng.waste[ng.waste.length - 1];
        const fi = FOUNDATION_SUITS.indexOf(top.suit);
        if (canPlaceOnFoundation(top, ng.foundations[fi])) {
          ng = JSON.parse(JSON.stringify(ng));
          ng.foundations[fi].push(ng.waste.pop());
          ng.moves++;
          changed = true;
        }
      }
    }
    return ng;
  };

  const handleStock = () => {
    const ng = JSON.parse(JSON.stringify(game));
    if (ng.stock.length) {
      const count = drawMode === 3 ? Math.min(3, ng.stock.length) : 1;
      for (let i = 0; i < count; i++) {
        const card = ng.stock.pop();
        card.faceUp = true;
        ng.waste.push(card);
      }
    } else {
      ng.stock = [...ng.waste].reverse().map(c => ({ ...c, faceUp: false }));
      ng.waste = [];
    }
    setSelected(null);
    setGame(autoFoundation(ng));
  };

  const handleWaste = () => {
    if (!game.waste.length) return;
    const card = game.waste[game.waste.length - 1];
    setSelected({ source: 'waste', card, cards: [card] });
  };

  const handleFoundation = (fi) => {
    if (!selected) return;
    const { cards } = selected;
    if (cards.length !== 1) return;
    const ng = JSON.parse(JSON.stringify(game));
    if (!canPlaceOnFoundation(cards[0], ng.foundations[fi])) { setSelected(null); return; }
    // remove from source
    if (selected.source === 'waste') ng.waste.pop();
    else {
      const pile = ng.tableau[selected.colIdx];
      pile.splice(selected.cardIdx);
      if (pile.length) pile[pile.length - 1].faceUp = true;
    }
    ng.foundations[fi].push(cards[0]);
    ng.moves++;
    setSelected(null);
    const final = autoFoundation(ng);
    final.won = checkWin(final);
    setGame(final);
  };

  const handleTableau = (colIdx, clickedCardIdx = null) => {
    const col = game.tableau[colIdx];
    if (selected) {
      // try to place
      const ng = JSON.parse(JSON.stringify(game));
      const target = ng.tableau[colIdx];
      const { cards } = selected;
      if (!canPlaceOnTableau(cards[0], target)) {
        // try foundation if single card
        if (cards.length === 1) {
          const fi = FOUNDATION_SUITS.indexOf(cards[0].suit);
          if (canPlaceOnFoundation(cards[0], ng.foundations[fi])) {
            if (selected.source === 'waste') ng.waste.pop();
            else {
              ng.tableau[selected.colIdx].splice(selected.cardIdx);
              if (ng.tableau[selected.colIdx].length) ng.tableau[selected.colIdx][ng.tableau[selected.colIdx].length-1].faceUp = true;
            }
            ng.foundations[fi].push(cards[0]);
            ng.moves++;
            setSelected(null);
            const final = autoFoundation(ng);
            final.won = checkWin(final);
            setGame(final);
            return;
          }
        }
        setSelected(null); return;
      }
      if (selected.source === 'waste') ng.waste.pop();
      else {
        ng.tableau[selected.colIdx].splice(selected.cardIdx);
        if (ng.tableau[selected.colIdx].length) ng.tableau[selected.colIdx][ng.tableau[selected.colIdx].length-1].faceUp = true;
      }
      target.push(...cards);
      ng.moves++;
      setSelected(null);
      const final = autoFoundation(ng);
      final.won = checkWin(final);
      setGame(final);
    } else {
      // select from tableau
      if (!col.length) return;
      // find first face-up card
      const firstUp = col.findIndex(c => c.faceUp);
      if (firstUp < 0) {
        // flip top card
        const ng = JSON.parse(JSON.stringify(game));
        ng.tableau[colIdx][col.length - 1].faceUp = true;
        ng.moves++;
        setGame(ng);
        return;
      }
      // Use the specific card clicked, or fall back to first face-up
      const selectFrom = clickedCardIdx !== null ? clickedCardIdx : firstUp;
      // Can only select from a face-up card
      if (!col[selectFrom]?.faceUp) {
        // clicking a face-down card — flip if it's the top card
        if (selectFrom === col.length - 1) {
          const ng = JSON.parse(JSON.stringify(game));
          ng.tableau[colIdx][col.length - 1].faceUp = true;
          ng.moves++;
          setGame(ng);
        }
        return;
      }
      setSelected({ source: 'tableau', colIdx, cardIdx: selectFrom, cards: col.slice(selectFrom) });
    }
  };

  const selId = selected ? selected.cards[0].id : null;

  return (
    <div>
      <style>{SOLITAIRE_CSS}</style>

      {/* Standard page header — suits, title, tagline */}
      <div style={{
        padding:"52px 0 28px", marginBottom:"20px",
        borderBottom:"1px solid var(--rule)",
        display:"flex", flexDirection:"column",
        alignItems:"center", textAlign:"center", gap:"10px",
        position:"relative",
      }}>
        <div className="header-suits" style={{letterSpacing:"0.22em"}}>
          <SuitIcon suit="spade"   size={16} style={{color:"var(--ink)"}}/>
          <SuitIcon suit="diamond" size={16} style={{color:"var(--red-suit)"}}/>
          <SuitIcon suit="club"    size={16} style={{color:"var(--ink)"}}/>
          <SuitIcon suit="heart"   size={16} style={{color:"var(--red-suit)"}}/>
        </div>
        <div className="header-title">the oblivion</div>
        {/* Tagline — Cormorant Unicase, no italic, readable */}
        <div style={{
          fontFamily:"var(--font-display)", fontSize:"15px",
          fontWeight:400, letterSpacing:"0.06em", textTransform:"lowercase",
          color:"var(--ash)", lineHeight:1.36, marginTop:"2px",
        }}>
          See Beyond The Oblivion Soon
        </div>
        <div style={{
          fontFamily:"var(--font-display)", fontSize:"15px",
          fontWeight:400, letterSpacing:"0.06em", textTransform:"lowercase",
          color:"var(--ink)", lineHeight:0.85,
          display:"inline-flex", alignItems:"center", gap:"8px",
        }}>
          For Now
          <SuitIcon suit="spade" size={13} style={{color:"var(--ink)"}}/>
          Solitaire
        </div>
      </div>

      {game.won ? (
        <div className="sol-win">
          <div className="sol-win-title">the oblivion lifts.</div>
          <div style={{fontFamily:"var(--font-body)",fontSize:"15px",color:"var(--ash)",marginBottom:"28px"}}>
            {moves} moves. the cards knew.
          </div>
          <button className="solitaire-btn" onClick={newGame}>play again</button>
        </div>
      ) : (
        <>
          {/* Draw mode tabs */}
          <div style={{display:"flex", gap:"0", marginBottom:"12px",
            border:"1px solid var(--rule)", borderRadius:"var(--card-radius)",
            overflow:"hidden"}}>
            {[1,3].map(n => (
              <button key={n}
                onClick={()=>{ setDrawMode(n); newGame(); }}
                style={{
                  flex:1, padding:"9px 0",
                  fontFamily:"'Montserrat',sans-serif",
                  fontSize:"8px", letterSpacing:"0.18em", textTransform:"uppercase",
                  background: drawMode===n ? "var(--ink)" : "transparent",
                  color: drawMode===n ? "var(--paper)" : "var(--silver)",
                  border:"none", borderLeft: n===3 ? "1px solid var(--rule)" : "none",
                  cursor:"pointer", transition:"all 0.15s",
                }}>
                Draw {n}
              </button>
            ))}
          </div>

          <div className="solitaire-controls">
            <div className="solitaire-stats">
              <span>{game.moves} moves</span>
              <span>{game.foundations.reduce((a,f)=>a+f.length,0)} / 52</span>
            </div>
            <button className="solitaire-btn" onClick={newGame}>new game</button>
          </div>

          {/* Top row: stock + waste + gap + foundations */}
          <div className="solitaire-top-row">
            {/* Stock */}
            <div onClick={handleStock} className="sol-stock">
              {game.stock.length
                ? <CardBack size={CARD_SIZE} dark={dark}/>
                : <SuitIcon suit="diamond" size={14} style={{color:"var(--silver)"}}/>
              }
            </div>
            {/* Waste — show top 3 fanned in 3-card mode */}
            <div style={{cursor:game.waste.length?"pointer":"default", position:"relative"}}>
              {game.waste.length === 0
                ? <div className="sol-empty"/>
                : drawMode === 3 && game.waste.length > 1
                  ? <div style={{position:"relative", height: CARD_SIZE * 1.4}}>
                      {game.waste.slice(-Math.min(3, game.waste.length)).map((wc, wi, arr) => {
                        const isTop = wi === arr.length - 1;
                        const isTopWaste = isTop;
                        return (
                          <div key={wc.id}
                            onClick={isTop ? handleWaste : undefined}
                            style={{
                              position:"absolute", top:0,
                              left: wi * 10,
                              zIndex: wi + 1,
                              opacity: isTop ? 1 : 0.7,
                              cursor: isTop ? "pointer" : "default",
                            }}>
                            <div style={{outline: isTop && selected?.source==='waste' ? '2px solid var(--red-suit)' : 'none', outlineOffset:2, borderRadius:4}}>
                              <MiniCard cardStr={cardStr(wc)} size={CARD_SIZE}/>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  : <div onClick={handleWaste} style={{outline: selected?.source==='waste' ? '2px solid var(--red-suit)' : 'none', outlineOffset:2, borderRadius:4}}>
                      <MiniCard cardStr={cardStr(game.waste[game.waste.length-1])} size={CARD_SIZE}/>
                    </div>
              }
            </div>
            {/* Gap */}
            <div/>
            {/* Foundations */}
            {FOUNDATION_SUITS.map((suit, fi) => (
              <div key={suit} onClick={()=>handleFoundation(fi)} style={{cursor:"pointer"}}>
                {game.foundations[fi].length
                  ? <MiniCard cardStr={cardStr(game.foundations[fi][game.foundations[fi].length-1])} size={CARD_SIZE}/>
                  : <div className="sol-foundation">
                      <div className="sol-foundation-suit">
                        <SuitIcon suit={suit.replace(/s$/,'')} size={16} style={{color: isRed(suit)?"var(--red-suit)":"var(--ink)"}}/>
                      </div>
                    </div>
                }
              </div>
            ))}
          </div>

          {/* Tableau */}
          <div className="solitaire-board">
            {game.tableau.map((col, colIdx) => {
              const rot = 0; // straight
              return (
                <div key={colIdx} className="sol-pile" onClick={()=>{ if(selected) handleTableau(colIdx); }}>
                  {col.length === 0
                    ? <div className="sol-empty" onClick={()=>selected && handleTableau(colIdx)}/>
                    : col.map((card, ci) => {
                        const isSelected = selected?.source==='tableau' && selected.colIdx===colIdx && ci>=selected.cardIdx;
                        const cardRot = 0; // all straight
                        return (
                          <div key={card.id}
                            className={`sol-card-wrap ${!card.faceUp?'face-down':''} ${isSelected?'selected':''}`}
                            style={{ marginTop: ci===0?0:'-82%', zIndex: ci+1 }}
                            onClick={(e)=>{ e.stopPropagation(); handleTableau(colIdx, ci); }}
                          >
                            <div style={{
                              filter: isSelected ? 'drop-shadow(0 0 6px rgba(139,18,18,0.6))' : undefined,
                              outline: ci===selected?.cardIdx && selected?.colIdx===colIdx ? '2px solid var(--red-suit)' : 'none',
                              outlineOffset: 2, borderRadius: 4,
                            }}>
                              {card.faceUp
                                ? <MiniCard cardStr={cardStr(card)} size={CARD_SIZE}/>
                                : <CardBack size={CARD_SIZE} dark={dark}/>
                              }
                            </div>
                          </div>
                        );
                      })
                  }
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}



// ── Ribbon Draw Animation ─────────────────────────────────────────────────
// Full-deck figure-8 ribbon, starts/ends at center, reveals the drawn card
const RBN_SP = {
  spades:{p:["M34 70L24 70H23L22 69.9999C22 69.9999 22.9433 70 12.0027 70C11.4505 69.9999 11 69.5522 11 69C11 68.4477 11.4531 68.0069 12.0016 67.9425C21.8639 66.785 22.1185 48.4873 22.0313 43.9917C22.0208 43.4483 22.4565 43 23 43C23.5442 43 23.9812 43.4477 23.9728 43.9918C23.9037 48.4864 24.2266 66.7748 33.9987 67.9415C34.5471 68.007 35 68.4477 35 69C35 69.5522 34.5523 69.9999 34 70Z","M39.5 48C32.5186 48 27.0415 45.2765 24.9358 44.0548C24.314 43.694 23.6146 43.4739 22.8958 43.4739C22.3079 43.4739 21.7341 43.6194 21.2082 43.8822C18.8527 45.0591 11.669 48.375 5.5 48.375C2.46243 48.375 0 45.9126 0 42.875V42C0 36.4772 4.80378 32.3519 9.60466 29.6218C20.9992 23.1421 21.9448 5.36783 22.002 0.986088C22.0092 0.436882 22.4539 7.62939e-06 23.0031 7.62939e-06C23.55 7.62939e-06 23.9936 0.433262 24.0039 0.980011C24.0865 5.37182 25.1361 23.3058 36.625 29.7121C41.3281 32.3345 46 36.3652 46 41.75C46 45.2018 43.2018 48 39.75 48H39.5Z"],c:[{cx:11.5,cy:43.5,r:11.5},{cx:34.5,cy:43.5,r:11.5}],vb:"0 0 46 70"},
  diamonds:{p:["M44.9832 33.9782C24.9362 33.1078 23.9695 6.47722 23.9837 0.984877C23.9851 0.439449 23.5454 0 23 0C22.4556 0 22.0175 0.440389 22.0221 0.984775C22.0679 6.47767 21.245 33.1153 1.01707 33.9785C0.465288 34.0021 0 34.4477 0 35C0 35.5523 0.46529 35.9979 1.01707 36.0215C21.245 36.8847 22.0679 63.5223 22.0221 69.0152C22.0175 69.5596 22.4556 70 23 70C23.5454 70 23.9851 69.5606 23.9837 69.0151C23.9695 63.5228 24.9362 36.8922 44.9832 36.0218C45.535 35.9979 46 35.5523 46 35C46 34.4477 45.535 34.0021 44.9832 33.9782Z"],c:[],vb:"0 0 46 70"},
  hearts:{p:["M39.5 24.875C32.6223 24.875 27.2045 26.0582 25.0319 26.6163C24.3419 26.7935 23.6377 26.9011 22.9254 26.9011C22.311 26.9011 21.7005 26.8207 21.1036 26.6756C18.6462 26.0781 11.5802 24.5 5.5 24.5H2.75C1.23122 24.5 0 25.7312 0 27.25V27.5C4.29691e-06 33.0229 4.81169 37.1515 9.58962 39.9215C21.0165 46.5464 21.9477 64.7713 22.0023 69.2146C22.009 69.7639 22.4538 70.2011 23.0031 70.2011C23.55 70.2011 23.9937 69.7673 24.0035 69.2205C24.0828 64.795 25.106 46.6116 36.4221 39.9556C41.1825 37.1556 46 33.0228 46 27.5C46 26.0503 44.8248 24.875 43.375 24.875H39.5Z"],c:[{cx:11.5,cy:26.5,r:11.5},{cx:34.5,cy:26.5,r:11.5}],vb:"0 0 46 71"},
  clubs:{p:["M23 10C18.03 10 14 14.03 14 19C14 22.1 15.6 24.83 18.03 26.45C14.06 27.8 11.22 31.56 11.22 36C11.22 41.63 15.81 46.22 21.44 46.22C22.63 46.22 23.77 46.01 24.83 45.63C24.28 47.04 24 48.56 24 50.11V52H22V54H24V56H26V54H28V52H26V50.11C26 48.56 25.72 47.04 25.17 45.63C26.23 46.01 27.37 46.22 28.56 46.22C34.19 46.22 38.78 41.63 38.78 36C38.78 31.56 35.94 27.8 31.97 26.45C34.4 24.83 36 22.1 36 19C36 14.03 31.97 10 27 10C25.6 10 24.28 10.35 23.12 10.96C23.07 10.65 23 10 23 10Z","M19 56L27 56L23 64Z"],c:[],vb:"0 0 46 70"},
};
const RBN_RED = new Set(["hearts","diamonds"]);

function RbnFace({w,h,rank,suit}) {
  const r=Math.max(3,Math.round(w*.07));
  const d=RBN_SP[suit],[,,vw,vh]=d.vb.split(" ").map(Number);
  const ink=RBN_RED.has(suit)?"#8b1212":"#0a0908";
  const fs=Math.round(w*.22);
  const cx=w*.14,ry=h*.19,cs=Math.round(w*.18),sy=h*.33;
  const rs=(x,y,iw,rot=false)=>{
    const sc=iw/vw,px=x+iw/2,py=y+(iw*vh/vw)/2;
    const tf=rot?`rotate(180,${px},${py}) translate(${x},${y}) scale(${sc})`:`translate(${x},${y}) scale(${sc})`;
    return <g transform={tf} fill={ink}>{d.p.map((p,i)=><path key={i} d={p}/>)}{d.c.map((c,i)=><circle key={i} cx={c.cx} cy={c.cy} r={c.r}/>)}</g>;
  };
  const corners=(<>
    <text x={cx} y={ry} fontSize={fs} fill={ink} fontFamily="'Cormorant Unicase',serif" fontWeight="400">{rank}</text>
    {rs(cx-cs*.1,sy-cs*.25,cs)}
    <text x={w-cx} y={h-ry} fontSize={fs} fill={ink} fontFamily="'Cormorant Unicase',serif" fontWeight="400" textAnchor="middle" transform={`rotate(180,${w-cx},${h-ry})`}>{rank}</text>
    {rs(w-cx-cs*.9,h-sy-cs*.75,cs,true)}
  </>);
  // Ace — big central icon
  if (rank==="A") {
    const aw=w*.55,ah=aw*(vh/vw),ax=(w-aw)/2,ay=(h-ah)/2;
    return (<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",position:"absolute",top:0,left:0}}>
      <rect width={w} height={h} rx={r} fill="#fdfaf5" stroke="rgba(10,10,10,0.1)" strokeWidth="0.8"/>
      <rect x={w*.07} y={h*.05} width={w*.86} height={h*.9} rx={r*.5} fill="none" stroke="rgba(10,10,10,0.06)" strokeWidth="0.4"/>
      <text x={cx} y={ry} fontSize={fs} fill={ink} fontFamily="'Cormorant Unicase',serif" fontWeight="400">A</text>
      <text x={w-cx} y={h-ry} fontSize={fs} fill={ink} fontFamily="'Cormorant Unicase',serif" fontWeight="400" textAnchor="middle" transform={`rotate(180,${w-cx},${h-ry})`}>A</text>
      {rs(ax,ay,aw)}
    </svg>);
  }
  // Face cards
  if (["J","Q","K"].includes(rank)) {
    const glyphs={"J":"♟","Q":"♛","K":"♚"},names={"J":"JACK","Q":"QUEEN","K":"KING"};
    return (<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",position:"absolute",top:0,left:0}}>
      <rect width={w} height={h} rx={r} fill="#fdfaf5" stroke="rgba(10,10,10,0.1)" strokeWidth="0.8"/>
      <rect x={w*.07} y={h*.05} width={w*.86} height={h*.9} rx={r*.5} fill="none" stroke="rgba(10,10,10,0.06)" strokeWidth="0.5"/>
      {corners}
      <text x={w/2} y={h*.52} textAnchor="middle" dominantBaseline="central" fontSize={Math.round(w*.38)} fill={ink} fontFamily="serif" opacity="0.9">{glyphs[rank]}</text>
      <text x={w/2} y={h*.83} textAnchor="middle" fontSize={Math.round(w*.16)} fill={ink} fontFamily="'Cormorant Unicase',serif" fontWeight="400" letterSpacing="0.08em" opacity="0.65">{names[rank]}</text>
    </svg>);
  }
  // Number cards — pip layout
  const count=parseInt(rank);
  const pips=PIP_LAYOUTS[count]||[];
  const pipFs=count<=6?Math.round(w*.22):count<=8?Math.round(w*.20):Math.round(w*.17);
  return (<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",position:"absolute",top:0,left:0}}>
    <rect width={w} height={h} rx={r} fill="#fdfaf5" stroke="rgba(10,10,10,0.1)" strokeWidth="0.8"/>
    {corners}
    {pips.map(([pcx,pcy],pi)=>{
      const px=w*pcx/100,py=h*pcy/100,rot=pcy>50;
      const baseW=Math.max(pipFs*.72,w*.14);
      const pipW=suit==="clubs"?Math.max(baseW,w*.17):baseW;
      return rs(px-pipW/2,py-pipW/2,pipW,rot);
    })}
  </svg>);
}

function RbnBack({w,h}) {
  const r=Math.max(3,Math.round(w*.07));
  const mw=w*.5,mx=(w-mw)/2,my=(h-mw*(150/154))/2;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",position:"absolute",top:0,left:0}}>
      <rect width={w} height={h} rx={r} fill="#fdfaf5" stroke="rgba(10,10,10,0.1)" strokeWidth="0.8"/>
      <rect x={w*.07} y={h*.05} width={w*.86} height={h*.9} rx={r*.5} fill="none" stroke="rgba(10,10,10,0.04)" strokeWidth="0.4"/>
      <g transform={`translate(${mx},${my}) scale(${mw/154})`} fill="rgba(10,9,8,0.85)">
        <path d="M72.5782 150C58.3472 150 45.6409 146.646 34.4594 139.939C23.4812 133.232 14.9426 124.289 8.84356 113.11C2.94785 101.728 0 89.4309 0 76.2195C0 60.3659 4.16766 46.6463 12.503 35.061C20.8383 23.4756 31.3083 14.7358 43.9129 8.84146C56.7208 2.94715 69.732 0 82.9465 0C97.1776 0 109.681 3.45529 120.455 10.3659C131.23 17.2764 139.464 26.3211 145.156 37.5C151.052 48.6789 154 60.3659 154 72.561C154 86.3821 150.341 99.2886 143.022 111.28C135.703 123.069 125.741 132.52 113.137 139.634C100.735 146.545 87.2158 150 72.5782 150ZM80.8119 143.902C97.6858 143.902 111.104 138.313 121.065 127.134C131.23 115.955 136.313 100.407 136.313 80.4878C136.313 66.8699 133.873 54.4715 128.994 43.2927C124.115 31.9106 116.898 22.8659 107.343 16.1585C97.7875 9.45122 86.301 6.09756 72.8832 6.09756C55.3993 6.09756 41.7782 11.687 32.0198 22.8659C22.4647 34.0447 17.6871 49.3902 17.6871 68.9024C17.6871 82.7236 20.1267 95.3252 25.0059 106.707C30.0884 118.089 37.4073 127.134 46.9624 133.841C56.5175 140.549 67.8007 143.902 80.8119 143.902Z"/>
      </g>
    </svg>
  );
}

function RbnTumble({rank,suit,w,h,flip,tilt=0}) {
  const a=((flip%360)+360)%360;
  const sx=Math.cos(a*Math.PI/180);
  const showBack=a>90&&a<270;
  const glow=Math.max(0,1-Math.abs(sx)*6);
  return (
    <div style={{
      width:w,height:h,position:"relative",flexShrink:0,
      transform:`scaleX(${sx}) scaleY(${Math.cos(tilt*Math.PI/180)})`,
      filter:glow>.08?`drop-shadow(0 0 10px rgba(255,255,255,${(glow*.5).toFixed(2)}))`:"none",
      willChange:"transform",
    }}>
      {showBack?<RbnBack w={w} h={h}/>:<RbnFace rank={rank} suit={suit} w={w} h={h}/>}
    </div>
  );
}

function rbnShuffleDeck() {
  const suits=["spades","hearts","diamonds","clubs"];
  const ranks=["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  const d=suits.flatMap(s=>ranks.map(r=>({rank:r,suit:s})));
  for(let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]];}
  return d;
}

// RibbonDrawAnimation: plays the ribbon loop, calls onReveal(card) when face shows
// onComplete: called after the reveal settles — caller navigates to pull screen
function RibbonDrawAnimation({ drawnCard, onReveal, onComplete }) {
  const raf = useRef(null), t0 = useRef(null);
  const [t, setT] = useState(0);
  const [phase, setPhase] = useState("intro");
  const deck = useRef(rbnShuffleDeck());
  // Place the drawn card as card 51 so it's the reveal
  useEffect(() => {
    const d = rbnShuffleDeck();
    if (drawnCard) {
      const idx = d.findIndex(c => c.rank===drawnCard.rank && c.suit===drawnCard.suit);
      if (idx>=0 && idx!==51) { [d[idx],d[51]]=[d[51],d[idx]]; }
    }
    deck.current = d;
  }, [drawnCard]);

  const CW = 120, CH = Math.round(CW*1.4);
  const GAP=0.048, TRAVEL=1.7, FLIP_SPEED=520;
  const T_STREAM=0.6;
  const T_RETURN=T_STREAM+GAP*52+TRAVEL;
  const T_FLIP=T_RETURN+0.4;
  const FLIP_DUR=1.8;
  const T_FACE=T_FLIP+FLIP_DUR;
  const TOTAL=T_FACE+0.8;

  // Lemniscate centered at angle=π/2
  const AX=180, AY=240;
  const lemX=a=>{const d=1+Math.sin(a)*Math.sin(a);return AX*Math.sin(a)*Math.cos(a)/d;};
  const lemY=a=>{const d=1+Math.sin(a)*Math.sin(a);return AY*Math.cos(a)/d;};

  const [trigger, setTrigger] = useState(1);

  useEffect(() => {
    t0.current=null; setT(0); setPhase("intro");
    const go=ts=>{
      if(!t0.current)t0.current=ts;
      const el=(ts-t0.current)/1000;
      setT(el);
      if(el<T_STREAM)       setPhase("intro");
      else if(el<T_RETURN)  setPhase("stream");
      else if(el<T_FLIP)    setPhase("return");
      else if(el<T_FACE) {
        if(phase!=="flip"&&phase!=="face") { setPhase("flip"); onReveal&&onReveal(deck.current[51]); }
        else setPhase("flip");
      }
      else if(el<TOTAL)     setPhase("face");
      else { setPhase("done"); onComplete&&onComplete(deck.current[51]); return; }
      raf.current=requestAnimationFrame(go);
    };
    raf.current=requestAnimationFrame(go);
    return()=>cancelAnimationFrame(raf.current);
  }, [trigger]);

  const eIO=t=>t<.5?2*t*t:-1+(4-2*t)*t;
  const revealCard=deck.current[51];
  const showReveal=phase==="intro"||phase==="return"||phase==="flip"||phase==="face";
  const flipAngle=phase==="flip"?180+eIO(Math.min((t-T_FLIP)/FLIP_DUR,1))*180:phase==="face"||phase==="done"?360:180;
  const cardRot=phase==="flip"?45*(1-eIO(Math.min((t-T_FLIP)/FLIP_DUR,1))):phase==="face"||phase==="done"?0:45;
  const revealScale=phase==="face"||phase==="done"?1.15:1;

  return (
    <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
      {/* Rotated ribbon layer */}
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",transform:"rotate(45deg) scale(1.35)",overflow:"hidden"}}>
        {phase==="stream"&&deck.current.map((card,i)=>{
          const lt=i*GAP, ct=t-T_STREAM-lt;
          if(ct<0)return null;
          const rawP=Math.min(ct/TRAVEL,1);
          const p=eIO(rawP);
          const angle=Math.PI/2+p*Math.PI*2;
          const lx=lemX(angle), ly=lemY(angle);
          const na=angle+.006;
          const tangent=Math.atan2(lemY(na)-ly,lemX(na)-lx)*180/Math.PI;
          const flip=ct*FLIP_SPEED+i*18;
          const tilt=Math.sin(angle*2)*20;
          const dist=Math.sqrt(lx*lx+ly*ly);
          const fadeC=Math.min(1,dist/80);
          const opacity=Math.min(rawP*10,1)*fadeC*Math.max(0,1-(rawP-.88)*10);
          if(opacity<0.01)return null;
          return (
            <div key={i} style={{position:"absolute",transform:`translate(${lx}px,${ly}px) rotate(${tangent+90}deg)`,zIndex:Math.round(p*52),opacity,filter:"drop-shadow(0 3px 10px rgba(0,0,0,0.8))"}}>
              <RbnTumble rank={card.rank} suit={card.suit} w={CW} h={CH} flip={flip} tilt={tilt}/>
            </div>
          );
        })}
      </div>

      {/* Reveal card — at true center, outside rotated layer */}
      {showReveal&&(
        <div style={{
          position:"absolute",zIndex:200,
          transform:`rotate(${cardRot}deg) scale(${revealScale})`,
          transition:phase==="face"?"transform 0.5s cubic-bezier(0.34,1.56,0.64,1)":"transform 0.1s linear",
          filter:phase==="face"?"drop-shadow(0 0 40px rgba(255,255,255,0.3))":"drop-shadow(0 6px 20px rgba(0,0,0,0.6))",
        }}>
          <RbnTumble rank={revealCard.rank} suit={revealCard.suit} w={CW} h={CH} flip={flipAngle} tilt={0}/>
        </div>
      )}
    </div>
  );
}

function StarGlyph({ size = 22, color = "currentColor", style = {} }) {
  return (
    <svg
      width={size}
      height={size * (67/45)}
      viewBox="0 0 45 67"
      fill="none"
      style={{display:"block",flexShrink:0,...style}}
    >
      <path
        d="M43.1843 32.1681C24.3567 31.1661 23.3526 6.86155 23.3758 1.18003C23.3784 0.529177 22.8546 0 22.2037 0C21.5501 0 21.025 0.534044 21.0313 1.18766C21.0867 6.88429 20.2059 31.1753 1.21604 32.1686C0.554209 32.2033 0 32.7373 0 33.4C0 34.0627 0.554072 34.5967 1.21591 34.6313C20.1092 35.6191 21.2322 59.6528 21.2242 65.518C21.2232 66.2209 21.789 66.8 22.4919 66.8C23.2009 66.8 23.7691 66.2097 23.7593 65.5009C23.6778 59.6074 24.4981 35.6276 43.1841 34.6319C43.8459 34.5967 44.4 34.0627 44.4 33.4C44.4 32.7373 43.8461 32.2033 43.1843 32.1681Z"
        fill={color}
      />
    </svg>
  );
}

function CardBack({ size = 48, dark = false }) {
  const w = size, h = Math.round(size * 1.4);
  const r = Math.max(2, Math.round(size * 0.06));
  // Inverted — black in light mode, paper in dark mode
  const bg = dark ? "#fdfaf5" : "#0a0908";
  const border = dark ? "rgba(10,10,10,0.15)" : "rgba(255,255,255,0.12)";
  const innerBorder = dark ? "rgba(10,10,10,0.08)" : "rgba(255,255,255,0.08)";
  // O: white in light mode (on black), dark ink in dark mode (on paper)
  const oColor = dark ? "#0a0908" : "rgba(255,255,255,0.92)";
  const starColor = dark ? "#b83232" : "#c94040";

  const markW = w * 0.50; // same proportion as O in nav Oracle button
  const markX = (w - markW) / 2;
  const markY = (h - markW * (150/154)) / 2;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{flexShrink:0,display:"block"}}>
      <rect width={w} height={h} rx={r} fill={bg} stroke={border} strokeWidth="0.5"/>
      <rect x={w*0.06} y={h*0.04} width={w*0.88} height={h*0.92} rx={r*0.5}
        fill="none" stroke={innerBorder} strokeWidth="0.5"/>
      {/* Oracle O — white on black / dark on light */}
      <g transform={`translate(${markX},${markY}) scale(${markW/154})`}>
        <path d="M72.5782 150C58.3472 150 45.6409 146.646 34.4594 139.939C23.4812 133.232 14.9426 124.289 8.84356 113.11C2.94785 101.728 0 89.4309 0 76.2195C0 60.3659 4.16766 46.6463 12.503 35.061C20.8383 23.4756 31.3083 14.7358 43.9129 8.84146C56.7208 2.94715 69.732 0 82.9465 0C97.1776 0 109.681 3.45529 120.455 10.3659C131.23 17.2764 139.464 26.3211 145.156 37.5C151.052 48.6789 154 60.3659 154 72.561C154 86.3821 150.341 99.2886 143.022 111.28C135.703 123.069 125.741 132.52 113.137 139.634C100.735 146.545 87.2158 150 72.5782 150ZM80.8119 143.902C97.6858 143.902 111.104 138.313 121.065 127.134C131.23 115.955 136.313 100.407 136.313 80.4878C136.313 66.8699 133.873 54.4715 128.994 43.2927C124.115 31.9106 116.898 22.8659 107.343 16.1585C97.7875 9.45122 86.301 6.09756 72.8832 6.09756C55.3993 6.09756 41.7782 11.687 32.0198 22.8659C22.4647 34.0447 17.6871 49.3902 17.6871 68.9024C17.6871 82.7236 20.1267 95.3252 25.0059 106.707C30.0884 118.089 37.4073 127.134 46.9624 133.841C56.5175 140.549 67.8007 143.902 80.8119 143.902Z" fill={oColor}/>
      </g>
      <g transform={`translate(${markX},${markY}) scale(${markW/154})`}>
        <path d="M98.9832 73.9782C78.9362 73.1078 77.9695 46.4772 77.9837 40.9849C77.9851 40.4394 77.5454 40 77 40C76.4556 40 76.0175 40.4404 76.0221 40.9848C76.0679 46.4777 75.245 73.1153 55.0171 73.9785C54.4653 74.0021 54 74.4477 54 75C54 75.5523 54.4653 75.9979 55.0171 76.0215C75.245 76.8847 76.0679 103.522 76.0221 109.015C76.0175 109.56 76.4556 110 77 110C77.5454 110 77.9851 109.561 77.9837 109.015C77.9695 103.523 78.9362 76.8922 98.9832 76.0218C99.535 75.9979 100 75.5523 100 75C100 74.4477 99.535 74.0021 98.9832 73.9782Z" fill={starColor}/>
      </g>
    </svg>
  );
}

// ── DoubleCard — Joker peeking behind the main card ───────────────────────
// Used when card string is "Joker & X" — Joker is the amplifier
function DoubleCard({ cardStr, size = 48 }) {
  const dark = useContext(DarkContext);

  // Parse "Joker & Q♦" into joker + main
  const parts = cardStr.split(/\s*&\s*/);
  const hasJoker = parts[0].toLowerCase().includes("joker");
  const mainCard = hasJoker ? parts[1] : parts[0];
  const jokerCard = "Joker";

  const w = size, h = Math.round(size * 1.4);

  // Joker peeks from bottom-left, rotated -12deg
  // Only corner visible — offset so ~30% of joker is hidden behind main card
  const jokerOffset = size * 0.22;
  const jokerRotate = -12;

  return (
    <div style={{
      position: "relative",
      width: w + jokerOffset,
      height: h + jokerOffset * 0.5,
      flexShrink: 0,
    }}>
      {/* Joker behind — bottom-left, rotated */}
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        transform: `rotate(${jokerRotate}deg)`,
        transformOrigin: "bottom left",
        filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.15))",
        zIndex: 1,
      }}>
        <MiniCard cardStr={jokerCard} size={size}/>
      </div>
      {/* Main card on top — offset to right */}
      <div style={{
        position: "absolute",
        bottom: 0,
        right: 0,
        filter: "drop-shadow(0 3px 10px rgba(0,0,0,0.18))",
        zIndex: 2,
      }}>
        <MiniCard cardStr={mainCard} size={size}/>
      </div>
    </div>
  );
}

// Helper — decides whether to render single or double card
function SmartCard({ cardStr, size = 48 }) {
  const isJokerPair = /joker/i.test(cardStr) && cardStr.includes("&");
  if (isJokerPair) return <DoubleCard cardStr={cardStr} size={size}/>;
  return <MiniCard cardStr={cardStr} size={size}/>;
}

function MiniCard({ cardStr, size = 48 }) {
  const dark = useContext(DarkContext);
  const parsed = parseCard(cardStr);
  const w = size, h = Math.round(size * 1.4);
  const isRed = parsed && RED_SUITS.has(parsed.suit);
  // Dark-mode aware colors
  const redInk = "#8b1212";  // always dark red on light bg
  const blackInk = "#0d0d0d"; // always near-black on light bg
  const ink = isRed ? redInk : blackInk;
  // Cards always render on light paper bg — more legible in both modes
  const bg = "#fdfaf5";
  const borderColor = "rgba(10,10,10,0.15)";
  const borderFaint = "rgba(10,10,10,0.08)";
  const latticeLine = "rgba(10,10,10,0.05)";
  const sparkle = "rgba(10,10,10,0.15)";
  const r = Math.max(2, Math.round(size * 0.06));

  if (!parsed) {
    // Tarot / unknown — inverted Oracle mark (matches CardBack)
    // Black bg in light mode, paper bg in dark mode
    const tarotBg = dark ? "#fdfaf5" : "#0a0908";
    const tarotBorder = dark ? "rgba(10,10,10,0.15)" : "rgba(255,255,255,0.12)";
    const tarotInner = dark ? "rgba(10,10,10,0.08)" : "rgba(255,255,255,0.08)";
    const oColor = dark ? "#0a0908" : "rgba(255,255,255,0.92)";
    const markW = w * 0.50;
    const markX = (w - markW) / 2;
    const markY = (h - markW * (150/154)) / 2;
    const markScale = markW / 154;
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{flexShrink:0,display:"block"}}>
        <rect width={w} height={h} rx={r} fill={tarotBg} stroke={tarotBorder} strokeWidth="0.5"/>
        <rect x={w*0.06} y={h*0.04} width={w*0.88} height={h*0.92} rx={r*0.5}
          fill="none" stroke={tarotInner} strokeWidth="0.5"/>
        <g transform={`translate(${markX},${markY}) scale(${markScale})`}>
          <path d="M72.5782 150C58.3472 150 45.6409 146.646 34.4594 139.939C23.4812 133.232 14.9426 124.289 8.84356 113.11C2.94785 101.728 0 89.4309 0 76.2195C0 60.3659 4.16766 46.6463 12.503 35.061C20.8383 23.4756 31.3083 14.7358 43.9129 8.84146C56.7208 2.94715 69.732 0 82.9465 0C97.1776 0 109.681 3.45529 120.455 10.3659C131.23 17.2764 139.464 26.3211 145.156 37.5C151.052 48.6789 154 60.3659 154 72.561C154 86.3821 150.341 99.2886 143.022 111.28C135.703 123.069 125.741 132.52 113.137 139.634C100.735 146.545 87.2158 150 72.5782 150ZM80.8119 143.902C97.6858 143.902 111.104 138.313 121.065 127.134C131.23 115.955 136.313 100.407 136.313 80.4878C136.313 66.8699 133.873 54.4715 128.994 43.2927C124.115 31.9106 116.898 22.8659 107.343 16.1585C97.7875 9.45122 86.301 6.09756 72.8832 6.09756C55.3993 6.09756 41.7782 11.687 32.0198 22.8659C22.4647 34.0447 17.6871 49.3902 17.6871 68.9024C17.6871 82.7236 20.1267 95.3252 25.0059 106.707C30.0884 118.089 37.4073 127.134 46.9624 133.841C56.5175 140.549 67.8007 143.902 80.8119 143.902Z" fill={oColor}/>
        </g>
      </svg>
    );
  }

  if (parsed.suit === "joker") {
    const fs = Math.round(size * 0.22);
    const jokerAccent = dark ? "#cccccc" : "#444";
    const jokerMain = dark ? "#ffffff" : "#222";
    const jokerSub = dark ? "#aaaaaa" : "#555";
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{flexShrink:0,display:"block"}}>
        <rect width={w} height={h} rx={r} fill={bg} stroke={borderColor} strokeWidth="0.5"/>
        <text x={w*0.12} y={h*0.18} fontSize={fs*0.8} fill={jokerAccent} fontFamily="'Montserrat',sans-serif" fontWeight="600">★</text>
        <text x={w/2} y={h*0.62} textAnchor="middle" fontSize={Math.round(size*0.34)} fill={jokerMain} fontFamily="'Cormorant Unicase',serif" fontWeight="300">J</text>
        <text x={w/2} y={h*0.78} textAnchor="middle" fontSize={Math.round(size*0.14)} fill={jokerSub} fontFamily="'Montserrat',sans-serif" letterSpacing="0.1em">OKER</text>
        <text x={w*0.88} y={h*0.96} fontSize={fs*0.8} fill={jokerAccent} fontFamily="'Montserrat',sans-serif" fontWeight="600" textAnchor="middle" transform={`rotate(180,${w*0.88},${h*0.96})`}>★</text>
      </svg>
    );
  }

  const sym = SUIT_SYMS[parsed.suit];
  const isFace = ["J","Q","K"].includes(parsed.rank);
  const isAce = parsed.rank === "A";
  const rankFs = Math.round(size * 0.19);
  const cornerSuitFs = Math.round(size * 0.16);
  // Corner padding
  const cx = w * 0.11;
  const rankY = h * 0.155;
  const suitY = h * 0.27;

  // Custom suit path data — same as SuitIcon but embedded inline for SVG context
  const SUIT_PATHS = {
    spades: { paths: [
      "M34 70L24 70H23L22 69.9999C22 69.9999 22.9433 70 12.0027 70C11.4505 69.9999 11 69.5522 11 69C11 68.4477 11.4531 68.0069 12.0016 67.9425C21.8639 66.785 22.1185 48.4873 22.0313 43.9917C22.0208 43.4483 22.4565 43 23 43C23.5442 43 23.9812 43.4477 23.9728 43.9918C23.9037 48.4864 24.2266 66.7748 33.9987 67.9415C34.5471 68.007 35 68.4477 35 69C35 69.5522 34.5523 69.9999 34 70Z",
      "M39.5 48C32.5186 48 27.0415 45.2765 24.9358 44.0548C24.314 43.694 23.6146 43.4739 22.8958 43.4739C22.3079 43.4739 21.7341 43.6194 21.2082 43.8822C18.8527 45.0591 11.669 48.375 5.5 48.375C2.46243 48.375 0 45.9126 0 42.875V42C0 36.4772 4.80378 32.3519 9.60466 29.6218C20.9992 23.1421 21.9448 5.36783 22.002 0.986088C22.0092 0.436882 22.4539 7.62939e-06 23.0031 7.62939e-06C23.55 7.62939e-06 23.9936 0.433262 24.0039 0.980011C24.0865 5.37182 25.1361 23.3058 36.625 29.7121C41.3281 32.3345 46 36.3652 46 41.75C46 45.2018 43.2018 48 39.75 48H39.5Z",
    ], circles: [{cx:11.5,cy:43.5,r:11.5},{cx:34.5,cy:43.5,r:11.5}], vb:"0 0 46 70" },
    diamonds: { paths: ["M44.9832 33.9782C24.9362 33.1078 23.9695 6.47722 23.9837 0.984877C23.9851 0.439449 23.5454 0 23 0C22.4556 0 22.0175 0.440389 22.0221 0.984775C22.0679 6.47767 21.245 33.1153 1.01707 33.9785C0.465288 34.0021 0 34.4477 0 35C0 35.5523 0.46529 35.9979 1.01707 36.0215C21.245 36.8847 22.0679 63.5223 22.0221 69.0152C22.0175 69.5596 22.4556 70 23 70C23.5454 70 23.9851 69.5606 23.9837 69.0151C23.9695 63.5228 24.9362 36.8922 44.9832 36.0218C45.535 35.9979 46 35.5523 46 35C46 34.4477 45.535 34.0021 44.9832 33.9782Z"], circles:[], vb:"0 0 46 70" },
    hearts: { paths: ["M39.5 24.875C32.6223 24.875 27.2045 26.0582 25.0319 26.6163C24.3419 26.7935 23.6377 26.9011 22.9254 26.9011C22.311 26.9011 21.7005 26.8207 21.1036 26.6756C18.6462 26.0781 11.5802 24.5 5.5 24.5H2.75C1.23122 24.5 0 25.7312 0 27.25V27.5C4.29691e-06 33.0229 4.81169 37.1515 9.58962 39.9215C21.0165 46.5464 21.9477 64.7713 22.0023 69.2146C22.009 69.7639 22.4538 70.2011 23.0031 70.2011C23.55 70.2011 23.9937 69.7673 24.0035 69.2205C24.0828 64.795 25.106 46.6116 36.4221 39.9556C41.1825 37.1556 46 33.0228 46 27.5C46 26.0503 44.8248 24.875 43.375 24.875H39.5Z"], circles:[{cx:11.5,cy:26.5,r:11.5},{cx:34.5,cy:26.5,r:11.5}], vb:"0 0 46 71" },
    clubs: { paths: [
      "M34 70L24 70H23L22 69.9999C22 69.9999 22.9433 70 12.0027 70C11.4505 69.9999 11 69.5522 11 69C11 68.4477 11.4531 68.0069 12.0016 67.9421C21.7779 66.7861 22.1133 48.6612 22.0335 43.9333C22.0232 43.3218 22.5135 42.8125 23.125 42.8125C23.6013 42.8125 23.9837 43.1967 23.9751 43.6729C23.898 47.9486 24.1233 66.7532 33.9987 67.9411C34.5471 68.0071 35 68.4477 35 69C35 69.5522 34.5523 69.9999 34 70Z",
      "M28.0252 10.1709C23.3339 11.9695 23.5024 16.906 23.8111 19.0191C23.8841 19.5184 23.5045 20 23 20C22.5139 20.0001 22.1613 19.512 22.2711 19.0385C22.7684 16.8947 23.3329 11.7781 18.0025 10.0678C15.6445 9.31115 13.4271 11.2164 12.8833 13.6325L12.4536 15.542C11.7084 18.8527 14.5605 22.124 16.869 24.6114C21.8971 30.0291 22.0971 42.2999 22.0335 46.0667C22.0232 46.6782 22.5135 47.1875 23.125 47.1875C23.6013 47.1875 23.9837 46.8034 23.9751 46.3272C23.9134 42.9088 24.0451 30.2037 29.147 24.6391C31.4403 22.1378 34.2916 18.8527 33.5464 15.542L33.1166 13.6325C32.5729 11.2164 30.3376 9.2843 28.0252 10.1709Z",
    ], circles:[{cx:11,cy:35,r:11},{cx:35,cy:35,r:11},{cx:23,cy:20,r:11}], vb:"0 0 46 70" },
  };

  // Render a custom suit icon inside SVG — scaled to iconW x iconH, placed at (x,y) top-left
  const renderSuitInSVG = (suit, x, y, iconW, rotate = false) => {
    const data = SUIT_PATHS[suit];
    if (!data) return null;
    const [vx,vy,vw,vh] = data.vb.split(" ").map(Number);
    const scaleX = iconW / vw;
    const scaleH = iconW * (vh / vw);
    const pivotX = x + iconW / 2;
    const pivotY = y + scaleH / 2;
    const transform = rotate
      ? `rotate(180,${pivotX},${pivotY}) translate(${x},${y}) scale(${scaleX})`
      : `translate(${x},${y}) scale(${scaleX})`;
    return (
      <g key={suit+x+y} transform={transform} fill={ink}>
        {data.paths.map((d,i) => <path key={i} d={d}/>)}
        {data.circles.map((c,i) => <circle key={"c"+i} cx={c.cx} cy={c.cy} r={c.r}/>)}
      </g>
    );
  };

  const iconW = cornerSuitFs * 0.7; // suit icon width in corner — proportional to rank text
  const iconH = iconW; // square — matches SuitIcon rendering

  const corners = (
    <>
      {/* Top-left: rank — suit icon only for face cards */}
      <text x={cx} y={rankY} fontSize={rankFs} fill={ink}
        fontFamily="'Cormorant Unicase', serif" fontWeight="400">{parsed.rank}</text>
      {isFace && renderSuitInSVG(parsed.suit, cx - iconW * 0.1, suitY - iconH * 0.25, iconW, false)}
      {/* Bottom-right: rotated */}
      <text x={w - cx} y={h - rankY} fontSize={rankFs} fill={ink}
        fontFamily="'Cormorant Unicase', serif" fontWeight="400"
        textAnchor="middle"
        transform={`rotate(180,${w - cx},${h - rankY})`}>{parsed.rank}</text>
      {isFace && renderSuitInSVG(parsed.suit, w - cx - iconW * 0.9, h - suitY - iconH * 0.75, iconW, true)}
    </>
  );

  if (!isFace) {
    const count = parseInt(parsed.rank);
    const pips = PIP_LAYOUTS[count] || [];
    const pipFs = count <= 6 ? Math.round(size * 0.22) : count <= 8 ? Math.round(size * 0.20) : Math.round(size * 0.17);
    const midY = 50;
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{flexShrink:0,display:"block"}}>
        <rect width={w} height={h} rx={r} fill={bg} stroke={borderColor} strokeWidth="0.5"/>
        {corners}
        {pips.map(([pcx,pcy],i) => {
          const px = w*pcx/100, py = h*pcy/100;
          const rot = pcy > midY;
          // Clubs need more room — their 3-circle geometry gets muddy at tiny sizes
          const baseW = Math.max(pipFs * 0.72, size * 0.14);
          const pipIconW = parsed.suit === 'clubs' ? Math.max(baseW, size * 0.17) : baseW;
          const pipIconH = pipIconW;
          return renderSuitInSVG(parsed.suit, px - pipIconW/2, py - pipIconH/2, pipIconW, rot);
        })}
      </svg>
    );
  }

  // ── Ace — big central suit icon, just "A" in corners, no suit below ────
  if (isAce) {
    const aceCornerSize = Math.round(size * 0.22);
    // Icon width 55% of card — height derived from 46×70 viewBox ratio
    const aceIconW = w * 0.55;
    const aceIconH = aceIconW * (70 / 46);
    const aceX = (w - aceIconW) / 2;
    const aceY = (h - aceIconH) / 2; // true vertical center
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{flexShrink:0,display:"block"}}>
        <rect width={w} height={h} rx={r} fill={bg} stroke={borderColor} strokeWidth="0.5"/>
        <rect x={w*0.07} y={h*0.05} width={w*0.86} height={h*0.9} rx={r*0.4}
          fill="none" stroke={ink} strokeWidth="0.4" opacity="0.15"/>
        <text x={cx} y={rankY} fontSize={aceCornerSize} fill={ink}
          fontFamily="'Cormorant Unicase', serif" fontWeight="400">A</text>
        <text x={w - cx} y={h - rankY} fontSize={aceCornerSize} fill={ink}
          fontFamily="'Cormorant Unicase', serif" fontWeight="400"
          textAnchor="middle"
          transform={`rotate(180,${w - cx},${h - rankY})`}>A</text>
        {(() => {
          const data = SUIT_PATHS[parsed.suit];
          if (!data) return null;
          const [,, vw] = data.vb.split(" ").map(Number);
          const scale = aceIconW / vw;
          return (
            <g transform={`translate(${aceX},${aceY}) scale(${scale})`} fill={ink}>
              {data.paths.map((d, i) => <path key={i} d={d}/>)}
              {data.circles.map((c, i) => <circle key={"c"+i} cx={c.cx} cy={c.cy} r={c.r}/>)}
            </g>
          );
        })()}
      </svg>
    );
  }

  const faceFs = Math.round(size * 0.38);
  const faceGlyph = { J: "♟", Q: "♛", K: "♚" }[parsed.rank];
  const faceName = { J: "JACK", Q: "QUEEN", K: "KING" }[parsed.rank];

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{flexShrink:0,display:"block"}}>
      <rect width={w} height={h} rx={r} fill={bg} stroke={borderColor} strokeWidth="0.5"/>
      <rect x={w*0.07} y={h*0.05} width={w*0.86} height={h*0.9} rx={r*0.4}
        fill="none" stroke={ink} strokeWidth="0.4" opacity="0.15"/>
      {corners}
      <text x={w/2} y={h*0.52} textAnchor="middle" dominantBaseline="central"
        fontSize={faceFs} fill={ink} fontFamily="serif" opacity="0.9">{faceGlyph}</text>
      <text x={w/2} y={h*0.83} textAnchor="middle"
        fontSize={Math.round(size * 0.16)} fill={ink}
        fontFamily="'Cormorant Unicase',serif"
        fontWeight="400" letterSpacing="0.08em" opacity="0.65">{faceName}</text>
    </svg>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function suitColor(cardName) {
  if (!cardName) return "var(--ink)";
  return (cardName.includes("♥") || cardName.includes("♦") ||
          cardName.toLowerCase().includes("heart") || cardName.toLowerCase().includes("cup") ||
          cardName.toLowerCase().includes("diamond") || cardName.toLowerCase().includes("pentacle"))
    ? "var(--red-suit)"
    : "var(--ink)";
}

// ── Virtual Deck Data ──────────────────────────────────────────────────────
const PLAYING_DECK = [
  "A♠","2♠","3♠","4♠","5♠","6♠","7♠","8♠","9♠","10♠","J♠","Q♠","K♠",
  "A♥","2♥","3♥","4♥","5♥","6♥","7♥","8♥","9♥","10♥","J♥","Q♥","K♥",
  "A♦","2♦","3♦","4♦","5♦","6♦","7♦","8♦","9♦","10♦","J♦","Q♦","K♦",
  "A♣","2♣","3♣","4♣","5♣","6♣","7♣","8♣","9♣","10♣","J♣","Q♣","K♣",
  "Joker","Joker★",
];

const TAROT_DECK = [
  // Major Arcana
  "The Fool","The Magician","The High Priestess","The Empress","The Emperor",
  "The Hierophant","The Lovers","The Chariot","Strength","The Hermit",
  "Wheel of Fortune","Justice","The Hanged Man","Death","Temperance",
  "The Devil","The Tower","The Star","The Moon","The Sun","Judgement","The World",
  // Minor Arcana — Wands
  "Ace of Wands","2 of Wands","3 of Wands","4 of Wands","5 of Wands",
  "6 of Wands","7 of Wands","8 of Wands","9 of Wands","10 of Wands",
  "Page of Wands","Knight of Wands","Queen of Wands","King of Wands",
  // Cups
  "Ace of Cups","2 of Cups","3 of Cups","4 of Cups","5 of Cups",
  "6 of Cups","7 of Cups","8 of Cups","9 of Cups","10 of Cups",
  "Page of Cups","Knight of Cups","Queen of Cups","King of Cups",
  // Swords
  "Ace of Swords","2 of Swords","3 of Swords","4 of Swords","5 of Swords",
  "6 of Swords","7 of Swords","8 of Swords","9 of Swords","10 of Swords",
  "Page of Swords","Knight of Swords","Queen of Swords","King of Swords",
  // Pentacles
  "Ace of Pentacles","2 of Pentacles","3 of Pentacles","4 of Pentacles","5 of Pentacles",
  "6 of Pentacles","7 of Pentacles","8 of Pentacles","9 of Pentacles","10 of Pentacles",
  "Page of Pentacles","Knight of Pentacles","Queen of Pentacles","King of Pentacles",
];

function shuffleDeck(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ── Card Flip / Reveal Animation ───────────────────────────────────────────
function CardReveal({ card, onComplete }) {
  const [phase, setPhase] = useState("shuffle"); // shuffle | flip | revealed
  const [displayCard, setDisplayCard] = useState(null);
  const [shuffleIdx, setShuffleIdx] = useState(0);
  // Normalize card — may arrive as string "7♣" or object {rank,suit}
  const cardStr2 = typeof card === "string" ? card
    : card ? card.rank + (card.suit==="spades"?"♠":card.suit==="hearts"?"♥":card.suit==="diamonds"?"♦":"♣") : "";
  const deck = cardStr2.includes("of") || cardStr2.startsWith("The") ? TAROT_DECK : PLAYING_DECK;

  useEffect(() => {
    // Rapid shuffle through random cards
    let count = 0;
    const maxShuffles = 18;
    const interval = setInterval(() => {
      setShuffleIdx(Math.floor(Math.random() * deck.length));
      count++;
      if (count >= maxShuffles) {
        clearInterval(interval);
        setTimeout(() => {
          setPhase("flip");
          setTimeout(() => {
            setDisplayCard(cardStr2);
            setPhase("revealed");
            setTimeout(() => onComplete && onComplete(), 600);
          }, 400);
        }, 100);
      }
    }, 60);
    return () => clearInterval(interval);
  }, []);

  const previewCard = phase === "revealed" ? card : deck[shuffleIdx] || card;

  return (
    <div style={{
      display:"flex", flexDirection:"column", alignItems:"center",
      gap:"24px", padding:"40px 0 20px",
    }}>
      <div style={{
        fontFamily:"var(--font-mono)", fontSize:"7px",
        letterSpacing:"0.2em", textTransform:"uppercase",
        color:"var(--ash)", marginBottom:"8px",
      }}>
        {phase === "shuffle" ? "shuffling" : phase === "flip" ? "drawing" : "your card"}
      </div>

      {/* Card container with flip */}
      <div style={{
        perspective:"600px", cursor:"default",
      }}>
        <div style={{
          transition: phase === "flip" ? "transform 0.4s ease" : "none",
          transform: phase === "flip" ? "rotateY(90deg)" : "rotateY(0deg)",
          transformStyle:"preserve-3d",
        }}>
          {phase === "revealed" || phase === "flip" ? (
            <div className="card-skew" style={{transform:"rotate(-2deg)"}}>
              <SmartCard cardStr={card} size={90}/>
            </div>
          ) : (
            <div style={{
              width:90, height:126,
              borderRadius:5,
              background:"var(--paper-dark)",
              border:"1px solid var(--rule)",
              boxShadow:"var(--card-shadow)",
              display:"flex", alignItems:"center", justifyContent:"center",
              position:"relative", overflow:"hidden",
            }}>
              {/* Lattice back pattern */}
              <svg width={90} height={126} style={{position:"absolute",inset:0}} viewBox="0 0 90 126">
                <rect width={90} height={126} fill="none"/>
                {Array.from({length:10},(_,i)=>(
                  <line key={`d${i}`} x1={i*10} y1={0} x2={0} y2={i*10} stroke="var(--rule)" strokeWidth="0.8"/>
                ))}
                {Array.from({length:20},(_,i)=>(
                  <line key={`u${i}`} x1={i*10} y1={126} x2={90} y2={126-i*10} stroke="var(--rule)" strokeWidth="0.8"/>
                ))}
                <rect x={6} y={8} width={78} height={110} rx={3} fill="none" stroke="var(--rule)" strokeWidth="0.8"/>
              </svg>
              {/* Flashing suit during shuffle */}
              <div style={{
                fontFamily:"serif", fontSize:"28px",
                color:"var(--ash)", opacity:0.3,
                transition:"opacity 0.05s",
                position:"relative", zIndex:1,
              }}>
                {["♠","♥","♦","♣"][shuffleIdx % 4]}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Card name reveal */}
      {phase === "revealed" && (
        <div style={{
          fontFamily:"var(--font-display)", fontSize:"28px", fontWeight:400,
          letterSpacing:"0.02em", textTransform:"lowercase",
          color:suitColor(card), textAlign:"center",
          animation:"fi 0.4s ease",
        }}>
          {card}
        </div>
      )}
    </div>
  );
}

// ── Typewriter hook ────────────────────────────────────────────────────────
function useTypewriter(text, speed = 18, startDelay = 800) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!text) return;
    setDisplayed("");
    setDone(false);
    let i = 0;
    const delay = setTimeout(() => {
      const tick = setInterval(() => {
        i++;
        setDisplayed(text.slice(0, i));
        if (i >= text.length) {
          clearInterval(tick);
          setDone(true);
        }
      }, speed);
      return () => clearInterval(tick);
    }, startDelay);
    return () => clearTimeout(delay);
  }, [text]);

  return { displayed, done };
}

// ── Hero Card component ────────────────────────────────────────────────────
// ── Week Bar ──────────────────────────────────────────────────────────────
const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];


// ── PageHeader ─────────────────────────────────────────────────────────────
function PageHeader({ title, sub, onMenu, onSettings }) {
  const DOTS = (<svg width="14" height="14" viewBox="0 0 4 16" fill="currentColor"><circle cx="2" cy="2" r="1.2"/><circle cx="2" cy="8" r="1.2"/><circle cx="2" cy="14" r="1.2"/></svg>);
  const BURGER = (<svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><rect y="0" width="16" height="1.5" rx="0.75"/><rect y="5" width="16" height="1.5" rx="0.75"/><rect y="10" width="16" height="1.5" rx="0.75"/></svg>);
  return (
    <div className="page-header">
      <div className="page-header-topbar">
        <button className="page-header-menu-btn" onClick={onMenu||(()=>{})}>{BURGER}</button>
        <div style={{width:32}}/>
        <button className="page-header-menu-btn" onClick={onSettings||(()=>{})}>{DOTS}</button>
      </div>
      <div className="page-header-title">{title}</div>
      {sub && <div className="page-header-sub">{sub}</div>}
    </div>
  );
}

// ── ModuleHeader ────────────────────────────────────────────────────────────
function ModuleHeader({ label, ctaLabel, onCta }) {
  return (
    <div className="module-header">
      <span className="module-header-label">{label}</span>
      {ctaLabel && onCta && (
        <button className="module-header-cta" onClick={onCta}>
          {ctaLabel}<span className="module-header-arrow"> →</span>
        </button>
      )}
    </div>
  );
}

function WeekBar({ pulls, today, contextProfile, onDayTap, onPullTap, onNavigateToObservatory }) {
  const [summary, setSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryLoaded, setSummaryLoaded] = useState(false);

  // Build last 7 days including today
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today + "T12:00:00");
    d.setDate(d.getDate() - (6 - i));
    const dateKey = d.toISOString().split("T")[0];
    return {
      dateKey,
      label: DAY_LABELS[d.getDay()],
      dayNum: d.getDate(),
      isToday: dateKey === today,
      pull: pulls[dateKey] || null,
    };
  });

  // Fetch one-sentence oracle summary when component mounts
  useEffect(() => {
    if (summaryLoaded) return;
    const pulledDays = days.filter(d => d.pull);
    if (pulledDays.length === 0) { setSummary("The week waits."); setSummaryLoaded(true); return; }

    setSummaryLoading(true);
    const pullList = pulledDays.map(d => `${d.dateKey}: ${d.pull.card}`).join(", ");

    const prompt = `Cards this week: ${pullList}.`;

    (async () => {
      try {
        const data = await callClaude({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 40,
            system: "Write a 1-2 line poem about someone's emotional week. Second person, dark, sardonic. No card names. No titles. Poem only.",
            messages: [{ role: "user", content: prompt }]
          }, "poem");
        const text = data.content?.find(b => b.type === "text")?.text || "";
        logSpend("week-poem", "claude-haiku-4-5-20251001", data.usage?.input_tokens||180, data.usage?.output_tokens||20);
        setSummary(text);
      } catch { setSummary("The week holds its patterns close."); }
      setSummaryLoading(false);
      setSummaryLoaded(true);
    })();
  }, [today]);

  return (
    <div className="week-bar">
      <div style={{paddingTop:"20px", borderTop:"1px solid var(--rule)"}}>
        <ModuleHeader label="Your Week at a Glance" ctaLabel="Dive Deeper" onCta={()=>{ onNavigateToObservatory && onNavigateToObservatory(); }}/>
      </div>

      {/* Calendar-style grid — headers row then cells row */}
      <div className="week-grid">
        {/* Day-of-week headers */}
        {days.map(({ dateKey, label, isToday, pull }) => (
          <div key={"hdr-"+dateKey} className="week-col-header"
            style={isToday ? {
              background: pull ? suitColor(pull.card) : "var(--red-suit)",
              color: "#fff",
            } : {}}
          >{label}</div>
        ))}
        {/* Card cells */}
        {days.map(({ dateKey, dayNum, isToday, pull }) => {
          const rot = pull ? cardRotation(dateKey, 22) : 0;
          return (
            <div
              key={"cell-"+dateKey}
              className={`week-cell ${pull ? "has-pull" : ""} ${isToday ? "is-today" : ""}`}
              onClick={() => {
                if (pull) onDayTap(pull);
                else if (isToday) onPullTap();
              }}
              style={isToday ? {
                background: pull ? suitColor(pull.card) : "var(--red-suit)",
              } : {}}
            >
              <div className="week-cell-date" style={isToday ? {color:"#fff", textAlign:"center", width:"100%"} : {}}>{dayNum}</div>
              {pull ? (
                <div className="card-skew" style={{transform:`rotate(${rot}deg)`}}>
                  <SmartCard cardStr={pull.card} size={34}/>
                </div>
              ) : isToday ? (
                <div className="week-cell-today-cta">
                  <span style={{
                    fontFamily:"'Montserrat',sans-serif",fontSize:"6px",
                    letterSpacing:"0.16em",textTransform:"uppercase",
                    fontWeight:600,display:"block",lineHeight:1,
                  }}>pull</span>
                  <SuitIcon suit="diamond" size={14} style={{color:"currentColor"}}/>
                  <span style={{
                    fontFamily:"'Montserrat',sans-serif",fontSize:"6px",
                    letterSpacing:"0.16em",textTransform:"uppercase",
                    fontWeight:600,display:"block",lineHeight:1,
                  }}>card</span>
                </div>
              ) : (
                <span className="week-cell-empty">·</span>
              )}
            </div>
          );
        })}
      </div>

      <div className={`week-bar-summary ${summaryLoading ? "loading" : ""}`}>
        {summaryLoading ? (
          <>
            <div className="oracle-dot"/><div className="oracle-dot"/><div className="oracle-dot"/>
          </>
        ) : summary}
      </div>
    </div>
  );
}

// Sparkle config — varied positions, sizes, durations
const SPARKLES = [
  { left:"38%", top:"30%", size:5, dur:"3.8s", delay:"0s",   dx:"-8px",  dy:"-28px", dx2:"-14px", dy2:"-55px", color:"var(--red-suit)" },
  { left:"62%", top:"40%", size:4, dur:"4.4s", delay:"0.7s", dx:"10px",  dy:"-32px", dx2:"18px",  dy2:"-58px", color:"var(--ash)" },
  { left:"28%", top:"55%", size:3, dur:"5.1s", delay:"1.2s", dx:"-12px", dy:"-22px", dx2:"-20px", dy2:"-48px", color:"var(--ink)" },
  { left:"71%", top:"28%", size:4, dur:"4.0s", delay:"1.8s", dx:"8px",   dy:"-35px", dx2:"12px",  dy2:"-60px", color:"var(--red-suit)" },
  { left:"50%", top:"20%", size:3, dur:"3.5s", delay:"2.3s", dx:"4px",   dy:"-25px", dx2:"8px",   dy2:"-50px", color:"var(--ash)" },
  { left:"20%", top:"35%", size:2, dur:"6.0s", delay:"0.4s", dx:"-6px",  dy:"-20px", dx2:"-10px", dy2:"-45px", color:"var(--ink)" },
  { left:"80%", top:"50%", size:3, dur:"4.7s", delay:"3.1s", dx:"10px",  dy:"-30px", dx2:"16px",  dy2:"-55px", color:"var(--red-suit)" },
];

function HeroCard({ pull, onTap, isNew = false, onOracle }) {
  const dark = useContext(DarkContext);
  const { displayed, done } = useTypewriter(pull?.reading || "", 16, isNew ? 900 : 0);
  const [flipPhase, setFlipPhase] = useState("back");
  const rot = cardRotation(pull?.date || "today", 4);

  useEffect(() => {
    const delay = isNew ? 400 : 280;
    const t = setTimeout(() => {
      setFlipPhase("flipping");
      setTimeout(() => setFlipPhase("face"), 360);
    }, delay);
    return () => clearTimeout(t);
  }, [pull?.date]);

  const size = 168;
  const cardH = Math.round(size * 1.4);
  const cardColor = suitColor(pull.card);

  // Format date for corner slot
  const [yr, mo, dy] = pull.date.split("-");
  const monthName = MONTHS[parseInt(mo) - 1];

  return (
    <div className="home-hero">

      {/* ── Sparkle stage + card ── */}
      <div className="hero-sparkle-stage" style={{height: cardH + 24}}>
        {/* Radial glow */}
        <div className="hero-glow"/>
        {/* Sparkle particles */}
        {SPARKLES.map((s, i) => (
          <div key={i} className="sparkle" style={{
            left: s.left, top: s.top,
            "--dur": s.dur, "--delay": s.delay,
            "--dx": s.dx, "--dy": s.dy,
            "--dx2": s.dx2, "--dy2": s.dy2,
          }}>
            <svg width={s.size * 2} height={s.size * 2} viewBox="0 0 10 10">
              <polygon points="5,0 6,4 10,5 6,6 5,10 4,6 0,5 4,4"
                fill={s.color} opacity="0.7"/>
            </svg>
          </div>
        ))}

        {/* The card itself */}
        <div
          className="hero-card-wrap"
          style={{ transform: `rotate(${rot}deg)`, perspective: "600px" }}
          onClick={onTap}
        >
          <div style={{
            position: "relative",
            width: size, height: cardH,
            transformStyle: "preserve-3d",
            transition: flipPhase === "flipping" ? "transform 0.58s cubic-bezier(0.4,0,0.2,1)" : "none",
            transform: flipPhase !== "back" ? "rotateY(180deg)" : "rotateY(0deg)",
          }}>
            <div style={{position:"absolute",inset:0,backfaceVisibility:"hidden",WebkitBackfaceVisibility:"hidden"}}>
              <CardBack size={size} dark={dark}/>
            </div>
            <div style={{position:"absolute",inset:0,backfaceVisibility:"hidden",WebkitBackfaceVisibility:"hidden",transform:"rotateY(180deg)"}}>
              <SmartCard cardStr={pull.card} size={size}/>
            </div>
          </div>
        </div>
      </div>

      {/* ── Hero body card — card overlaps from above ── */}
      <div className="hero-body" onClick={onTap}>

        {/* Corner info slots */}
        <div className="hero-corners">
          {/* Top-left: date */}
          <div>
            <div className="hero-corner-day">{parseInt(dy)}</div>
            <div className="hero-corner-date">{monthName}</div>
          </div>
          {/* Top-right: dig deeper button */}
          <button className="hero-dig-btn" onClick={e => { e.stopPropagation(); onOracle(); }}>
            <div className="hero-dig-label">Ask the Oracle</div>
            <div>Dig deeper ↓</div>
          </button>
        </div>

        {/* Card name */}
        <CardTitle cardStr={pull.card} className="hero-card-name" style={{fontSize:"clamp(28px,7vw,46px)"}}/>

        {pull.intention && (
          <div style={{
            fontFamily:"var(--font-body)",
            fontSize:"14px", color:"var(--ash)", marginBottom:"14px",
          }}>
            "{pull.intention}"
          </div>
        )}

        <div className={`hero-reading ${done ? "done" : ""}`}>
          {isNew ? displayed : pull.reading}
        </div>

        <div style={{
          marginTop:"18px",
          fontFamily:"var(--font-mono)", fontSize:"8px",
          letterSpacing:"0.22em", textTransform:"uppercase",
          color:"var(--silver)",
        }}>
          tap to open full reading
        </div>
      </div>

      {/* ── Oracle CTA ── */}
      <button className="oracle-hero-cta beckoning" onClick={onOracle}>
        <SuitIcon suit="diamond" size={11} style={{color:"currentColor", opacity:0.7}}/>
        Ask the Oracle
        <SuitIcon suit="diamond" size={11} style={{color:"currentColor", opacity:0.7}}/>
      </button>
    </div>
  );
}

// ── Oracle Chat Component ──────────────────────────────────────────────────
// ── Oracle Page — unified persistent chat ─────────────────────────────────
// All conversations live in one feed. Day chips separate sessions by date.
// No overlay, no back button — this IS the oracle tab.
function OraclePage({ pulls, contextProfile, today, onNavigateToDay }) {
  const [allMessages, setAllMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [activeDateKey, setActiveDateKey] = useState(null);
  const feedEndRef = useRef(null);
  const inputRef = useRef(null);

  // Load all stored conversations on mount, ordered by date
  useEffect(() => {
    (async () => {
      const sortedDates = Object.keys(pulls).sort();
      const msgs = [];
      for (const dateKey of sortedDates) {
        try {
          const stored = await storage.get(`oracle_convo_${dateKey}`);
          if (stored) {
            const convo = JSON.parse(stored.value);
            if (convo.length > 0) {
              msgs.push({ type: "divider", dateKey, pull: pulls[dateKey] });
              convo.forEach(m => msgs.push({ type: "msg", dateKey, ...m }));
            }
          }
        } catch {}
      }
      // Always show today's divider at the bottom even if no convo yet
      const todayHasDivider = msgs.find(m => m.dateKey === today && m.type === "divider");
      if (pulls[today] && !todayHasDivider) {
        msgs.push({ type: "divider", dateKey: today, pull: pulls[today] });
      }
      setAllMessages(msgs);
      setActiveDateKey(today);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (loaded) feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages, loaded]);

  const saveConvo = async (dateKey, msgs) => {
    const convoMsgs = msgs
      .filter(m => m.type === "msg" && m.dateKey === dateKey)
      .map(m => ({ role: m.role, content: m.content }));
    try { await storage.set(`oracle_convo_${dateKey}`, JSON.stringify(convoMsgs)); } catch {}
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const dateKey = activeDateKey || today;
    const pull = pulls[dateKey];

    const hasDivider = allMessages.find(m => m.dateKey === dateKey && m.type === "divider");
    const userMsg = { type: "msg", dateKey, role: "user", content: text };
    const withUser = hasDivider
      ? [...allMessages, userMsg]
      : [...allMessages, { type: "divider", dateKey, pull }, userMsg];

    setAllMessages(withUser);
    setLoading(true);

    const history = withUser
      .filter(m => m.type === "msg" && m.dateKey === dateKey)
      .map(m => ({ role: m.role, content: m.content }));

    const systemPrompt = `${contextProfile}

You are The Channel Oracle, a daily divination companion blending the rigor of historical cartomancy (Lenormand, Etteilla, 19th-century British systems, French Piquet) with direct, grounded honesty.

Your voice: poetic when the cards demand it, sardonic when they don't, always precise. You cite actual historical card meanings when relevant. You notice patterns, repetitions, suit runs. No moralizing, no flattery.

Current date: ${dateKey}
${pull ? `Card pulled: ${pull.card} (${pull.deck})` : "General oracle conversation, no card pulled yet"}
${pull?.intention ? `Intention: ${pull.intention}` : ""}
${pull?.reflection ? `Reflection: ${pull.reflection}` : ""}`;

    try {
      const data = await callClaude({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          system: systemPrompt,
          messages: history.slice(-8)
        }, "chat");
      logSpend("oracle-page-chat", "claude-haiku-4-5-20251001", data.usage?.input_tokens||800, data.usage?.output_tokens||200);
      const reply = data.content?.find(b => b.type === "text")?.text || "";
      const replyMsg = { type: "msg", dateKey, role: "assistant", content: reply };
      const updated = [...withUser, replyMsg];
      setAllMessages(updated);
      await saveConvo(dateKey, updated);
    } catch {
      const errMsg = { type: "msg", dateKey, role: "assistant", content: "Lost the signal. Try again." };
      setAllMessages([...withUser, errMsg]);
    }
    setLoading(false);
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const hasAnyConversation = allMessages.some(m => m.type === "msg");

  return (
    <div className="oracle-page">
      <PageHeader title="the oracle" sub="ask. listen. return daily."/>

      {/* Message feed */}
      <div className="oracle-feed">
        {!loaded && (
          <div style={{display:"flex",gap:10,alignItems:"flex-start",padding:"24px 0"}}>
            <div className="oracle-msg-avatar"><StarGlyph size={13} color="currentColor"/></div>
            <div className="oracle-msg-bubble typing">
              <div className="oracle-dot"/><div className="oracle-dot"/><div className="oracle-dot"/>
            </div>
          </div>
        )}

        {loaded && !hasAnyConversation && (
          <div className="oracle-empty-state">
            <StarGlyph size={32} color="var(--silver)"/>
            <div className="oracle-empty-state-title">the Oracle is open</div>
            <div className="oracle-empty-state-sub">ask anything · pull a card · begin</div>
          </div>
        )}

        {allMessages.map((item, i) => {
          if (item.type === "divider") {
            return (
              <div key={`div-${item.dateKey}-${i}`} className="oracle-day-divider">
                <div
                  className="oracle-day-chip"
                  onClick={() => {
                    setActiveDateKey(item.dateKey);
                    if (item.pull) onNavigateToDay(item.pull);
                  }}
                >
                  <div className="oracle-day-chip-date">{formatDate(item.dateKey)}</div>
                  {item.pull && (
                    <div className="oracle-day-chip-card" style={{color: suitColor(item.pull.card)}}>
                      {item.pull.card}
                    </div>
                  )}
                </div>
              </div>
            );
          }
          return (
            <div key={`msg-${item.dateKey}-${i}`} className={`oracle-msg ${item.role === "user" ? "user" : ""}`}>
              <div className="oracle-msg-avatar">
                {item.role === "assistant"
                  ? <StarGlyph size={13} color="currentColor"/>
                  : "B"}
              </div>
              <div className="oracle-msg-bubble" style={{whiteSpace:"pre-wrap"}}>
                {item.content}
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="oracle-thinking" style={{paddingBottom:"8px"}}>
            <div className="oracle-thinking-suit"><SuitIcon suit="spade"   size={14} style={{color:"var(--ink)"}}/></div>
            <div className="oracle-thinking-suit"><SuitIcon suit="diamond" size={14} style={{color:"var(--red-suit)"}}/></div>
            <div className="oracle-thinking-suit"><SuitIcon suit="club"    size={14} style={{color:"var(--ink)"}}/></div>
            <div className="oracle-thinking-suit"><SuitIcon suit="heart"   size={14} style={{color:"var(--red-suit)"}}/></div>
          </div>
        )}
        <div ref={feedEndRef}/>
      </div>

      {/* Input bar */}
      <div className="oracle-input-row">
        <textarea
          ref={inputRef}
          className="oracle-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="ask the Oracle..."
          rows={1}
        />
        <button className="oracle-send" onClick={sendMessage} disabled={!input.trim() || loading}>
          <SuitIcon suit="spade" size={16} style={{color:"#fff", transform:"rotate(90deg)", display:"block"}}/>
        </button>
      </div>
    </div>
  );
}


// ── Onboarding ─────────────────────────────────────────────────────────────
const ONBOARD_CSS = `
  .ob-root {
    position:fixed; inset:0; z-index:9999;
    background:#020101; color:#f0ece4;
    display:flex; flex-direction:column;
    align-items:center; justify-content:center;
    font-family:'Cormorant Unicase','Georgia',serif;
    text-transform:lowercase;
    overflow:hidden;
  }
  .ob-screen {
    width:100%; max-width:400px; padding:0 28px;
    display:flex; flex-direction:column; align-items:center;
    animation:obIn 0.55s cubic-bezier(0.34,1.2,0.64,1) both;
  }
  @keyframes obIn {
    from { opacity:0; transform:translateY(28px); }
    to   { opacity:1; transform:none; }
  }
  .ob-exit {
    animation:obOut 0.38s ease forwards;
  }
  @keyframes obOut {
    to { opacity:0; transform:translateY(-20px); }
  }
  .ob-mark {
    animation:obMarkIn 1.4s cubic-bezier(0.34,1.2,0.64,1) both,
               obMarkFloat 4s ease-in-out 1.4s infinite;
    margin-bottom:32px;
  }
  @keyframes obMarkIn {
    from { opacity:0; transform:scale(0.5); }
    to   { opacity:1; transform:scale(1); }
  }
  @keyframes obMarkFloat {
    0%,100% { transform:translateY(0); }
    50%      { transform:translateY(-8px); }
  }
  .ob-wordmark {
    font-size:38px; font-weight:300; letter-spacing:0.08em;
    text-transform:lowercase; color:#f0ece4;
    margin-bottom:10px; text-align:center;
    animation:obIn 0.7s cubic-bezier(0.34,1.2,0.64,1) 0.3s both;
  }
  .ob-tagline {
    font-family:'Montserrat',sans-serif; font-size:7px;
    letter-spacing:0.28em; text-transform:uppercase;
    color:rgba(240,236,228,0.38); text-align:center;
    animation:obIn 0.6s ease 0.7s both;
    margin-bottom:48px;
  }
  .ob-suits {
    font-size:13px; letter-spacing:0.3em;
    color:rgba(240,236,228,0.2);
    animation:obIn 0.5s ease 1s both;
  }
  .ob-suits span.red { color:rgba(224,64,64,0.35); }

  /* Cycling suit inside the O mark */
  .ob-mark-inner {
    position:relative; display:flex;
    align-items:center; justify-content:center;
  }
  .ob-suit-cycle {
    position:absolute;
    display:flex; align-items:center; justify-content:center;
    animation:suitCycle 4s linear infinite;
    pointer-events:none; user-select:none;
    opacity:0;
  }
  @keyframes suitCycle {
    0%          { opacity:0; transform:scale(0.6); }
    5%          { opacity:1; transform:scale(1); }
    20%         { opacity:1; transform:scale(1); }
    28%         { opacity:0; transform:scale(0.7); }
    100%        { opacity:0; transform:scale(0.6); }
  }
  .ob-suit-cycle:nth-child(2) { animation-delay:0s; }
  .ob-suit-cycle:nth-child(3) { animation-delay:1s; }
  .ob-suit-cycle:nth-child(4) { animation-delay:2s; }
  .ob-suit-cycle:nth-child(5) { animation-delay:3s; }

  /* Google button */
  .ob-btn-google {
    width:100%; padding:16px 20px; margin-bottom:12px;
    background:rgba(240,236,228,0.06);
    border:1px solid rgba(240,236,228,0.22);
    border-radius:4px; cursor:pointer;
    font-family:'Montserrat',sans-serif;
    font-size:8px; font-weight:600;
    letter-spacing:0.22em; text-transform:uppercase;
    color:rgba(240,236,228,0.88);
    display:flex; align-items:center; justify-content:center; gap:10px;
    transition:all 0.2s;
  }
  .ob-btn-google:hover {
    border-color:rgba(240,236,228,0.4);
    color:#f0ece4;
    background:rgba(240,236,228,0.12);
  }
  .ob-btn-google svg { flex-shrink:0; }

  /* Tertiary — guest — legible on dark bg */
  .ob-btn-tertiary {
    background:none; border:none; cursor:pointer;
    font-family:'Montserrat',sans-serif; font-size:7px;
    letter-spacing:0.18em; text-transform:uppercase;
    color:rgba(240,236,228,0.52);
    padding:12px 0; margin-top:4px;
    transition:color 0.2s;
  }
  .ob-btn-tertiary:hover { color:rgba(240,236,228,0.8); }

  .ob-divider {
    width:100%; display:flex; align-items:center; gap:12px;
    margin:4px 0 12px;
  }
  .ob-divider-line {
    flex:1; height:1px; background:rgba(240,236,228,0.08);
  }
  .ob-divider-text {
    font-family:'Montserrat',sans-serif; font-size:7px;
    letter-spacing:0.14em; text-transform:uppercase;
    color:rgba(240,236,228,0.2);
  }
  .ob-heading {
    font-size:30px; font-weight:300; letter-spacing:0.03em;
    text-align:center;
    margin-bottom:10px; line-height:0.98;
  }
  .ob-sub {
    font-family:'Montserrat',sans-serif; font-size:10px;
    letter-spacing:0.16em; text-transform:uppercase;
    color:rgba(240,236,228,0.55); text-align:center;
    margin-bottom:40px; line-height:1.8;
  }
  .ob-input {
    width:100%; background:rgba(240,236,228,0.06);
    border:1px solid rgba(240,236,228,0.14);
    border-radius:4px; padding:16px 20px;
    font-family:'Cormorant Unicase',serif; font-size:18px;
    font-weight:300; color:#f0ece4; outline:none;
    text-align:center; letter-spacing:0.04em; text-transform:lowercase;
    transition:border-color 0.2s;
    margin-bottom:16px;
    caret-color:rgba(224,64,64,0.8);
  }
  .ob-input::placeholder { color:rgba(240,236,228,0.2); }
  .ob-input:focus { border-color:rgba(240,236,228,0.32); }
  .ob-btn {
    width:100%; padding:18px 20px; margin-bottom:12px;
    background:#8b1212; color:#f0ece4;
    border:none; border-radius:4px; cursor:pointer;
    font-family:'Montserrat',sans-serif; font-size:8px;
    font-weight:600; letter-spacing:0.26em; text-transform:uppercase;
    transition:opacity 0.2s, transform 0.15s;
    box-shadow:0 4px 28px rgba(139,18,18,0.55);
    position:relative; overflow:hidden;
  }
  .ob-btn::before {
    content:""; position:absolute; inset:0;
    background:linear-gradient(105deg,transparent 30%,rgba(255,255,255,0.08) 50%,transparent 70%);
    background-size:200% 100%;
    animation:obShimmer 2.2s ease-in-out infinite;
  }
  @keyframes obShimmer {
    0% { background-position:200% 0; opacity:0; }
    30% { opacity:1; } 70% { opacity:1; }
    100% { background-position:-200% 0; opacity:0; }
  }
  .ob-btn:hover { opacity:0.88; transform:scale(1.01); }
  .ob-btn:active { transform:scale(0.98); }
  .ob-btn:disabled { opacity:0.35; cursor:default; transform:none; }
  .ob-btn-ghost {
    width:100%; padding:14px 20px;
    background:transparent; color:rgba(240,236,228,0.38);
    border:1px solid rgba(240,236,228,0.1); border-radius:4px;
    cursor:pointer; font-family:'Montserrat',sans-serif;
    font-size:8px; letter-spacing:0.22em; text-transform:uppercase;
    transition:all 0.2s;
  }
  .ob-btn-ghost:hover { border-color:rgba(240,236,228,0.22); color:rgba(240,236,228,0.6); }
  .ob-deck-options {
    display:grid; grid-template-columns:1fr 1fr;
    gap:10px; width:100%; margin-bottom:28px;
  }
  .ob-deck-btn {
    padding:20px 16px; border-radius:4px; cursor:pointer;
    border:1px solid rgba(240,236,228,0.12);
    background:rgba(240,236,228,0.04);
    display:flex; flex-direction:column; align-items:center; gap:8px;
    transition:all 0.2s; color:#f0ece4;
  }
  .ob-deck-btn.selected {
    border-color:rgba(224,64,64,0.6);
    background:rgba(224,64,64,0.08);
  }
  .ob-deck-icon { font-size:22px; letter-spacing:0.1em; }
  .ob-deck-label {
    font-family:'Montserrat',sans-serif; font-size:7px;
    letter-spacing:0.2em; text-transform:uppercase;
    opacity:0.7;
  }
  .ob-deck-desc {
    font-family:'Montserrat',sans-serif; font-size:6px;
    letter-spacing:0.1em; text-transform:uppercase;
    color:rgba(240,236,228,0.35); margin-top:2px;
  }
  .ob-textarea {
    width:100%; background:rgba(240,236,228,0.06);
    border:1px solid rgba(240,236,228,0.14);
    border-radius:4px; padding:16px 20px;
    font-family:'Cormorant Unicase',serif; font-size:16px;
    font-weight:300; color:#f0ece4; outline:none;
    letter-spacing:0.04em; resize:none;
    transition:border-color 0.2s; margin-bottom:16px;
    caret-color:rgba(224,64,64,0.8);
    min-height:100px; line-height:1.6;
  }
  .ob-textarea::placeholder { color:rgba(240,236,228,0.2); }
  .ob-textarea:focus { border-color:rgba(240,236,228,0.32); }
  .ob-rule { width:40px; height:1px; background:rgba(240,236,228,0.1); margin:24px auto; }
  .ob-verified-badge {
    display:flex; align-items:center; gap:8px;
    padding:12px 20px; border-radius:4px;
    background:rgba(240,236,228,0.06);
    border:1px solid rgba(240,236,228,0.12);
    margin-bottom:24px; width:100%;
    font-family:'Montserrat',sans-serif; font-size:7px;
    letter-spacing:0.18em; text-transform:uppercase;
    color:rgba(240,236,228,0.55);
  }
  /* Step top bar — back arrow left, dots center, spacer right */
  .ob-progress-bar {
    display:flex; align-items:center; justify-content:space-between;
    width:100%; margin-bottom:32px;
  }
  .ob-back {
    width:32px; height:32px; display:flex; align-items:center; justify-content:center;
    background:none; border:none; cursor:pointer;
    color:rgba(240,236,228,0.5); transition:color 0.2s; flex-shrink:0;
  }
  .ob-back:hover { color:rgba(240,236,228,0.9); }
  .ob-progress {
    display:flex; gap:20px; align-items:center;
  }
  .ob-suit-pip {
    transition: color 0.35s ease, filter 0.35s ease;
    cursor: pointer; display:flex;
  }
  /* Big step numeral — Cormorant, ghost */
  .ob-step-num {
    font-family:'Cormorant Unicase',Georgia,serif;
    font-size:88px; font-weight:300; line-height:0.85;
    letter-spacing:-0.02em;
    color:rgba(240,236,228,0.12);
    text-align:center; margin-bottom:8px;
    user-select:none; text-transform:lowercase;
  }
  .ob-skip {
    font-family:'Montserrat',sans-serif; font-size:7px;
    letter-spacing:0.2em; text-transform:uppercase;
    color:rgba(240,236,228,0.48); background:none; border:none;
    cursor:pointer; padding:12px; margin-top:4px;
    transition:color 0.2s;
  }
  .ob-skip:hover { color:rgba(240,236,228,0.82); }
  .ob-email-sent {
    text-align:center; padding:28px 0;
  }
  .ob-email-icon { font-size:36px; margin-bottom:16px; display:block; }
  .ob-ready-mark {
    animation:obReadyPulse 1.2s cubic-bezier(0.34,1.56,0.64,1) both;
    margin-bottom:28px;
  }
  @keyframes obReadyPulse {
    from { transform:scale(0.3) rotate(-10deg); opacity:0; }
    to   { transform:scale(1) rotate(0deg); opacity:1; }
  }
`;

function OracleMark({ size=80, color="#f0ece4", opacity=1 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 154 154" fill="none" style={{opacity}}>
      <path fill={color} d="M72.5782 150C58.3472 150 45.6409 146.646 34.4594 139.939C23.4812 133.232 14.9426 124.289 8.84356 113.11C2.94785 101.728 0 89.4309 0 76.2195C0 60.3659 4.16766 46.6463 12.503 35.061C20.8383 23.4756 31.3083 14.7358 43.9129 8.84146C56.7208 2.94715 69.732 0 82.9465 0C97.1776 0 109.681 3.45529 120.455 10.3659C131.23 17.2764 139.464 26.3211 145.156 37.5C151.052 48.6789 154 60.3659 154 72.561C154 86.3821 150.341 99.2886 143.022 111.28C135.703 123.069 125.741 132.52 113.137 139.634C100.735 146.545 87.2158 150 72.5782 150ZM80.8119 143.902C97.6858 143.902 111.104 138.313 121.065 127.134C131.23 115.955 136.313 100.407 136.313 80.4878C136.313 66.8699 133.873 54.4715 128.994 43.2927C124.115 31.9106 116.898 22.8659 107.343 16.1585C97.7875 9.45122 86.301 6.09756 72.8832 6.09756C55.3993 6.09756 41.7782 11.687 32.0198 22.8659C22.4647 34.0447 17.6871 49.3902 17.6871 68.9024C17.6871 82.7236 20.1267 95.3252 25.0059 106.707C30.0884 118.089 37.4073 127.134 46.9624 133.841C56.5175 140.549 67.8007 143.902 80.8119 143.902Z"/>
    </svg>
  );
}

// ── OblivionProGate ──────────────────────────────────────────────────────────
const PRO_FEATURES = [
  { suit:"diamond", red:true,  label:"unlimited readings",        desc:"no monthly cap. pull every day, as many times as you need." },
  { suit:"spade",   red:false, label:"multi-card spreads",        desc:"three-card past/present/future. celtic cross. custom layouts." },
  { suit:"heart",   red:true,  label:"the deeper oracle",         desc:"extended conversations that carry memory across sessions." },
  { suit:"club",    red:false, label:"pattern reading",           desc:"monthly themes, recurring symbols, your full arc analyzed." },
  { suit:"diamond", red:true,  label:"ritual calendar",           desc:"moon phases, seasonal turning points, daily intentions." },
  { suit:"spade",   red:false, label:"the oblivion",              desc:"a separate space. no guidance. no answers. only the cards." },
];

function OblivionProGate({ dark }) {
  const [solitaireOpen, setSolitaireOpen] = React.useState(false);

  if (solitaireOpen) return (
    <div>
      <button onClick={()=>setSolitaireOpen(false)} style={{
        display:"flex", alignItems:"center", gap:"6px",
        background:"none", border:"none", cursor:"pointer",
        color:"var(--ash)", padding:"20px 0 8px",
        fontFamily:"'Montserrat',sans-serif", fontSize:"8px",
        letterSpacing:"0.22em", textTransform:"uppercase",
      }}>
        ← back to oblivion
      </button>
      <SolitaireGame dark={dark}/>
    </div>
  );

  return (
    <div style={{paddingBottom:"80px"}}>

      {/* Hero */}
      <div style={{
        textAlign:"center", paddingTop:"8px", paddingBottom:"36px",
        borderBottom:"1px solid var(--rule)", marginBottom:"32px",
      }}>
        <div style={{
          fontFamily:"'Montserrat',sans-serif", fontSize:"8px",
          letterSpacing:"0.3em", textTransform:"uppercase",
          color:"var(--red-suit)", marginBottom:"16px",
        }}>oracle pro</div>
        <div style={{
          fontFamily:"var(--font-display)", fontSize:"clamp(36px,7vw,52px)",
          fontWeight:300, letterSpacing:"0.01em", textTransform:"lowercase",
          lineHeight:0.85, color:"var(--ink)", marginBottom:"20px",
        }}>
          beyond the veil.
        </div>
        <div style={{
          fontFamily:"'Montserrat',sans-serif", fontSize:"10px",
          letterSpacing:"0.16em", textTransform:"uppercase",
          color:"var(--ash)", lineHeight:1.8, maxWidth:"300px", margin:"0 auto 28px",
        }}>
          The cards have more to say.<br/>You just need to listen deeper.
        </div>

        {/* CTA */}
        <button style={{
          padding:"14px 32px",
          background:"var(--red-suit)", border:"none", borderRadius:"3px",
          fontFamily:"'Montserrat',sans-serif", fontSize:"9px",
          letterSpacing:"0.24em", textTransform:"uppercase",
          color:"#fff", cursor:"pointer",
        }}
          onClick={()=>{/* Stripe checkout */}}
        >
          ♦ unlock oracle pro ♦
        </button>
      </div>

      {/* Locked features */}
      <div style={{display:"flex", flexDirection:"column", gap:"0"}}>
        {PRO_FEATURES.map(({ suit, red, label, desc }, i) => (
          <div key={i} style={{
            display:"flex", alignItems:"flex-start", gap:"16px",
            padding:"20px 0", borderBottom:"1px solid var(--rule)",
          }}>
            {/* Lock + suit */}
            <div style={{
              flexShrink:0, width:"32px", height:"32px",
              display:"flex", alignItems:"center", justifyContent:"center",
              color: red ? "var(--red-suit)" : "var(--ink)", opacity:0.35,
            }}>
              <SuitIcon suit={suit} size={16}/>
            </div>
            <div style={{flex:1}}>
              <div style={{
                fontFamily:"var(--font-display)", fontSize:"18px",
                fontWeight:400, textTransform:"lowercase", letterSpacing:"0.02em",
                color:"var(--ink)", lineHeight:0.9, marginBottom:"6px",
                display:"flex", alignItems:"center", gap:"8px",
              }}>
                {label}
                <span style={{
                  fontSize:"7px", letterSpacing:"0.14em", padding:"2px 5px",
                  borderRadius:"2px", background:"rgba(201,64,64,0.12)",
                  color:"var(--red-suit)", fontFamily:"'Montserrat',sans-serif",
                  textTransform:"uppercase", alignSelf:"center",
                }}>locked</span>
              </div>
              <div style={{
                fontFamily:"'Montserrat',sans-serif", fontSize:"10px",
                letterSpacing:"0.08em", color:"var(--ash)", lineHeight:1.7,
              }}>
                {desc}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pricing hint */}
      <div style={{
        textAlign:"center", paddingTop:"36px", paddingBottom:"8px",
      }}>
        <div style={{
          fontFamily:"'Montserrat',sans-serif", fontSize:"8px",
          letterSpacing:"0.22em", textTransform:"uppercase",
          color:"var(--ash)", marginBottom:"4px",
        }}>
          pricing coming soon
        </div>
        <div style={{
          fontFamily:"var(--font-display)", fontSize:"13px",
          color:"var(--silver)", letterSpacing:"0.04em", textTransform:"lowercase",
        }}>
          early access will be discounted.
        </div>
      </div>

      {/* Solitaire link — free forever */}
      <div style={{textAlign:"center", paddingTop:"28px"}}>
        <button onClick={()=>setSolitaireOpen(true)} style={{
          background:"none", border:"none", cursor:"pointer",
          fontFamily:"'Montserrat',sans-serif", fontSize:"8px",
          letterSpacing:"0.2em", textTransform:"uppercase",
          color:"var(--silver)", padding:"8px",
        }}>
          ♠ play solitaire while you wait ♠
        </button>
      </div>
    </div>
  );
}

// ── WelcomeStep ─────────────────────────────────────────────────────────────
// Isolated so it can own the Google One Tap useEffect lifecycle
function WelcomeStep({ advance }) {
  const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  React.useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const init = () => {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          await supabase.auth.signInWithIdToken({ provider: "google", token: credential });
          // onAuthStateChange in OracleApp handles navigation from here
        },
        auto_select: false,
        cancel_on_tap_outside: true,
        context: "signin",
        itp_support: true,
      });
      window.google.accounts.id.prompt();
    };
    if (window.google?.accounts?.id) {
      init();
    } else {
      // Script not yet loaded — wait for it
      const script = document.querySelector("script[src*='accounts.google.com/gsi']");
      script?.addEventListener("load", init);
      return () => script?.removeEventListener("load", init);
    }
    return () => window.google?.accounts?.id?.cancel?.();
  }, [GOOGLE_CLIENT_ID]);

  const triggerOneTap = () => {
    if (window.google?.accounts?.id) {
      window.google.accounts.id.prompt();
    } else {
      // Fallback to OAuth redirect if GIS unavailable
      signInWithGoogle();
    }
  };

  return <>
    <div className="ob-mark" style={{marginBottom:24}}>
      <div className="ob-mark-inner">
        <OracleMark size={56}/>
        <div className="ob-suit-cycle"><SuitIcon suit="spade"   size={18} style={{color:"rgba(240,236,228,0.55)"}}/></div>
        <div className="ob-suit-cycle"><SuitIcon suit="diamond" size={18} style={{color:"rgba(224,64,64,0.7)"}}/></div>
        <div className="ob-suit-cycle"><SuitIcon suit="club"    size={18} style={{color:"rgba(240,236,228,0.55)"}}/></div>
        <div className="ob-suit-cycle"><SuitIcon suit="heart"   size={18} style={{color:"rgba(224,64,64,0.7)"}}/></div>
      </div>
    </div>
    <div className="ob-heading" style={{marginBottom:8}}>
      Oracle.<br/>Daily Divination.
    </div>
    <div className="ob-sub">
      Seekers have asked the cards for centuries.<br/>
      The questions never really change.<br/>
      One card. One day. One question.
    </div>

    {/* Primary — Google One Tap */}
    <button className="ob-btn-google" onClick={triggerOneTap}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
      continue with google
    </button>

    <div className="ob-divider">
      <div className="ob-divider-line"/>
      <span className="ob-divider-text">or</span>
      <div className="ob-divider-line"/>
    </div>

    {/* Secondary — email */}
    <button className="ob-btn-tertiary" onClick={()=>advance("email")}>
      continue with email
    </button>

    {/* Guest */}
    <button className="ob-btn-tertiary" style={{marginTop:4,opacity:0.5}} onClick={()=>advance("app")}>
      continue as guest
    </button>
  </>;
}

function Onboarding({ step, onComplete, onUpdate, user }) {
  const [email, setEmail] = React.useState("");
  const [emailSent, setEmailSent] = React.useState(false);
  const [name, setName] = React.useState("");
  const [deck, setDeck] = React.useState("playing");
  const [intention, setIntention] = React.useState("");
  const [exiting, setExiting] = React.useState(false);

  const STEPS = ["welcome","email","name","deck","intention"];
  const stepIdx = STEPS.indexOf(step);

  const advance = (nextStep, updates={}) => {
    setExiting(true);
    setTimeout(() => {
      setExiting(false);
      onUpdate({ ...updates });
      onComplete(nextStep);
    }, 360);
  };

  const finishOnboard = async () => {
    setExiting(true);
    const userData = { name, email, deck, intention,
      joinedAt: new Date().toISOString() };
    try {
      await storage.set("oracle_user", JSON.stringify(userData));
      // Build context profile from onboarding data
      const deckLabel = deck === "playing" ? "traditional 52-card playing cards" : "78-card tarot";
      const intentionPart = intention ? " Their current intention or focus: " + intention + "." : "";
      const ctx = "You are reading for " + (name || "a seeker") + ", who practices daily card pulls as a ritual of reflection and guidance. Their preferred deck: " + deckLabel + "." + intentionPart + " This is a disciplined, reflective practice — not a casual horoscope check. Speak with care, directness, and honesty.";
      await storage.set("oracle_context", ctx);
    } catch {}
    setTimeout(() => {
      setExiting(false);
      onComplete("completing");
    }, 360);
  };

  const skip = () => advance("app");

  // Completion flash — suits cycle then go to "ready"
  if (step === "completing") return (
    <div className="ob-root" style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
      <style>{ONBOARD_CSS}</style>
      <SuitsFlash onDone={() => onComplete("app")}/>
    </div>
  );

  // Login flash — same animation but returns to "app"
  if (step === "login-flash") return (
    <div className="ob-root" style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
      <style>{ONBOARD_CSS}</style>
      <SuitsFlash onDone={() => onComplete("app")}/>
    </div>
  );

  if (step === "splash") return (
    <div className="ob-root">
      <style>{ONBOARD_CSS}</style>
      <div className="ob-mark">
        <div className="ob-mark-inner">
          <OracleMark size={72}/>
          <div className="ob-suit-cycle"><SuitIcon suit="spade"   size={20} style={{color:"rgba(240,236,228,0.55)"}}/></div>
          <div className="ob-suit-cycle"><SuitIcon suit="diamond" size={20} style={{color:"rgba(224,64,64,0.7)"}}/></div>
          <div className="ob-suit-cycle"><SuitIcon suit="club"    size={20} style={{color:"rgba(240,236,228,0.55)"}}/></div>
          <div className="ob-suit-cycle"><SuitIcon suit="heart"   size={20} style={{color:"rgba(224,64,64,0.7)"}}/></div>
        </div>
      </div>
      <div className="ob-wordmark">oracle</div>
      <div className="ob-tagline-block">
        <div className="ob-tagline">Daily Divination</div>
      </div>
      <div className="ob-suits">
        <span>♠ </span><span className="red">♦ </span><span>♣ </span><span className="red">♥</span>
      </div>
    </div>
  );

  if (step === "ready") return (
    <div className="ob-root">
      <style>{ONBOARD_CSS}</style>
      <div className="ob-screen">
        <div className="ob-ready-mark">
          <OracleMark size={64}/>
        </div>
        <div className="ob-heading">
          {name ? `welcome, ${name.toLowerCase()}.` : "welcome."}
        </div>
        <div className="ob-sub">
          your practice begins now.
        </div>
        <button className="ob-btn" onClick={() => {
          setExiting(true);
          setTimeout(() => onComplete("app"), 600);
        }}>
          ♦ enter the oracle ♦
        </button>
      </div>
    </div>
  );

  return (
    <div className="ob-root">
      <style>{ONBOARD_CSS}</style>
      <div className={`ob-screen ${exiting?"ob-exit":""}`}>

        {/* Step top bar — back, dots, spacer */}
        {stepIdx >= 0 && (
          <div className="ob-progress-bar">
            <button className="ob-back" onClick={() => {
              const prev = STEPS[stepIdx - 1];
              if (prev) advance(prev);
            }} style={{visibility: stepIdx === 0 ? "hidden" : "visible"}}>
              <svg width="18" height="14" viewBox="0 0 18 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="17" y1="7" x2="1" y2="7"/>
                <polyline points="7,1 1,7 7,13"/>
              </svg>
            </button>
            <div className="ob-progress">
              {[
                { s:"email",     suit:"spade",   red:false },
                { s:"name",      suit:"diamond", red:true  },
                { s:"deck",      suit:"club",    red:false },
                { s:"intention", suit:"heart",   red:true  },
              ].map(({ s, suit, red }, i) => {
                const realIdx = i + 1;
                const isDone   = realIdx < stepIdx;
                const isActive = realIdx === stepIdx;
                const lit = red ? "#c94040" : "rgba(240,236,228,0.9)";
                const mid = red ? "rgba(201,64,64,0.5)" : "rgba(240,236,228,0.5)";
                const dim = red ? "rgba(201,64,64,0.18)" : "rgba(240,236,228,0.18)";
                const color = isActive ? lit : isDone ? mid : dim;
                return (
                  <div key={s} className="ob-suit-pip"
                    onClick={() => { if (realIdx < stepIdx) advance(s); }}
                    style={{ color }}>
                    <SuitIcon suit={suit} size={13}/>
                  </div>
                );
              })}
            </div>
            <div style={{width:32}}/>
          </div>
        )}

        {/* WELCOME */}
        {step === "welcome" && <WelcomeStep advance={advance}/>}


        {/* EMAIL */}
        {step === "email" && <>
          <div className="ob-step-num">1</div>
          <div className="ob-heading">your email.</div>
          <div className="ob-sub">
            we send a magic link.<br/>no password. ever.
          </div>
          {!emailSent ? <>
            <input
              className="ob-input"
              type="email"
              placeholder="you@wherever.com"
              value={email}
              onChange={e=>setEmail(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&email.includes("@")){signInWithEmail(email).then(()=>setEmailSent(true));}}}
              autoFocus
            />
            <button className="ob-btn"
              disabled={!email.includes("@")}
              onClick={()=>signInWithEmail(email).then(()=>setEmailSent(true))}>
              send magic link →
            </button>
          </> : (
            <div className="ob-email-sent">
              <span className="ob-email-icon">♦</span>
              <div className="ob-heading" style={{fontSize:22,marginBottom:8}}>check your inbox.</div>
              <div className="ob-sub" style={{marginBottom:32}}>
                link sent to<br/><span style={{color:"rgba(240,236,228,0.7)"}}>{email}</span>
              </div>
              <button className="ob-btn" onClick={()=>advance("name",{email})}>
                i'm in →
              </button>
              <button className="ob-skip" onClick={()=>{setEmailSent(false);signInWithEmail(email);}}>
                resend
              </button>
            </div>
          )}
          <button className="ob-skip" onClick={()=>advance("name",{email})}>skip for now</button>
        </>}

        {/* NAME */}
        {step === "name" && <>
          <div className="ob-step-num">2</div>
          <div className="ob-heading">what should<br/>the oracle call you?</div>
          <div className="ob-sub">first name is fine.</div>
          <input
            className="ob-input"
            type="text"
            placeholder="your name"
            value={name}
            onChange={e=>setName(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&name.trim())advance("deck",{name});}}
            autoFocus
          />
          <button className="ob-btn"
            disabled={!name.trim()}
            onClick={()=>advance("deck",{name})}>
            continue →
          </button>
          <button className="ob-skip" onClick={()=>advance("deck",{name:""})}>skip</button>
        </>}

        {/* DECK */}
        {step === "deck" && <>
          <div className="ob-step-num">3</div>
          <div className="ob-heading">your modality.</div>
          <div className="ob-sub" style={{marginBottom:24}}>
            choose your primary deck.<br/>you can change this anytime.
          </div>
          <div className="ob-deck-options">
            <button
              className={`ob-deck-btn ${deck==="playing"?"selected":""}`}
              onClick={()=>setDeck("playing")}>
              <div className="ob-deck-icon">♠ ♦</div>
              <div className="ob-deck-label">Playing Cards</div>
              <div className="ob-deck-desc">52 cards · traditional</div>
            </button>
            <button
              className={`ob-deck-btn ${deck==="tarot"?"selected":""}`}
              onClick={()=>setDeck("tarot")}>
              <div className="ob-deck-icon">♣ ♥</div>
              <div className="ob-deck-label">Tarot</div>
              <div className="ob-deck-desc">78 cards · arcana</div>
            </button>
          </div>
          <button className="ob-btn" onClick={()=>advance("intention",{deck})}>
            continue →
          </button>
        </>}

        {/* INTENTION */}
        {step === "intention" && <>
          <div className="ob-step-num">4</div>
          <div className="ob-heading">
            what are you<br/>seeking?
          </div>
          <div className="ob-sub">
            this seeds your oracle readings.<br/>be honest. be specific.
          </div>
          <textarea
            className="ob-textarea"
            placeholder={"clarity on a decision.\na relationship in flux.\nwhere to put my energy.\nor just — to listen."}
            value={intention}
            onChange={e=>setIntention(e.target.value)}
            rows={4}
            autoFocus
          />
          <button className="ob-btn" onClick={()=>{ finishOnboard(); }}>
            ♦ enter the oracle ♦
          </button>
          <button className="ob-skip" onClick={()=>{ setIntention(""); finishOnboard(); }}>skip</button>
        </>}

      </div>
    </div>
  );
}

// ── Dev spend logger ───────────────────────────────────────────────────────
// Tracks every API call cost in localStorage. View in DevTools:
//   JSON.parse(localStorage.getItem("oracle_spend_log"))
// Reset: localStorage.removeItem("oracle_spend_log")
const IS_DEV = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const PRICING = {
  sonnet: { in: 3/1e6,   out: 15/1e6  },
  haiku:  { in: 0.8/1e6, out: 4/1e6   },
};
function logSpend(callName, model, inputTokens, outputTokens) {
  const tier = model.includes("haiku") ? "haiku" : "sonnet";
  const cost = (inputTokens * PRICING[tier].in) + (outputTokens * PRICING[tier].out);
  if (IS_DEV) {
    console.log(`[💸 oracle] ${callName} (${tier}) ~$${cost.toFixed(5)} | in:${inputTokens} out:${outputTokens}`);
  }
  try {
    const log = JSON.parse(localStorage.getItem("oracle_spend_log") || "[]");
    log.push({ callName, model: tier, inputTokens, outputTokens, cost: +cost.toFixed(6), ts: new Date().toISOString() });
    localStorage.setItem("oracle_spend_log", JSON.stringify(log.slice(-100)));
  } catch {}
}

// ── App ────────────────────────────────────────────────────────────────────
export default function OracleApp() {
  const [pulls, setPulls] = useState({});
  const [activeTab, setActiveTab] = useState("home"); // home | archive | pull | oracle | veil | reading | profile | settings | settings
  const [onboardStep, setOnboardStep] = useState("loading"); // loading | splash | welcome | email | verify | name | deck | intention | ready | app
  const [onboardUser, setOnboardUser] = useState({ name:"", email:"", deck:"playing", intention:"" });
  const [profileBio, setProfileBio] = useState("");
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileFriends] = useState([]); // future: real friends list
  const [onboardEmail, setOnboardEmail] = useState("");
  const [onboardEmailSent, setOnboardEmailSent] = useState(false);
  const [onboardName, setOnboardName] = useState("");
  const [onboardIntention, setOnboardIntention] = useState("");
  const [onboardDeck, setOnboardDeck] = useState("playing");
  const [darkMode, setDarkMode] = useState(true);
  const [calView, setCalView] = useState("calendar");
  const [calYear, setCalYear] = useState(2026);
  const [calMonth, setCalMonth] = useState(2); // 0-indexed March
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [ghostCard, setGhostCard] = useState(null);
  const [intakeDate, setIntakeDate] = useState("");
  const [intakeCard, setIntakeCard] = useState("");
  const [intakeDeck, setIntakeDeck] = useState("playing");
  const [intakeNote, setIntakeNote] = useState("");
  const [intakeSaved, setIntakeSaved] = useState(false);
  const [contextProfile, setContextProfile] = useState(CONTEXT_DRAFT);
  const [contextSaved, setContextSaved] = useState(false);
  const [contextEditing, setContextEditing] = useState(true);

  const [reflectionDraft, setReflectionDraft] = useState("");
  const [resonanceMap, setResonanceMap] = useState({}); // date → 0-4 index
  const [defaultDeck, setDefaultDeck] = useState("playing");
  const [defaultStyle, setDefaultStyle] = useState("dialogue");
  const [pullDeck, setPullDeck] = useState("playing");
  const [pullCard, setPullCard] = useState("");
  const [pullIntention, setPullIntention] = useState("");
  const [offeringIntention, setOfferingIntention] = useState("");
  const [offeringExpanded, setOfferingExpanded] = useState(false); // selector panel open
  const [isRecording, setIsRecording] = React.useState(false);
  const [chatExpanded, setChatExpanded] = React.useState(false);
  const [chatRecording, setChatRecording] = React.useState(false);
  const chatRecognitionRef = React.useRef(null);
  const chatMessagesRef = React.useRef(null);
  // Oracle chat state — must be declared before the auto-scroll useEffect

  // Declare oracle chat state BEFORE the useEffect that reads them
  const [pullOracleMessages, setPullOracleMessages] = useState([]);
  const [pullOracleInput, setPullOracleInput] = useState("");
  const [pullOracleLoading, setPullOracleLoading] = useState(false);
    // Auto-scroll chat to bottom when new messages arrive
  React.useEffect(() => {
    if (chatMessagesRef.current && chatExpanded) {
      chatMessagesRef.current.scrollTo({
        top: chatMessagesRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [pullOracleMessages, pullOracleLoading, chatExpanded]);
  const [drawAnim, setDrawAnim] = useState(null); // null | "fading" | "animating" | "revealing"
  const drawRafRef = React.useRef(null);
  const drawT0Ref = React.useRef(null);
  const [drawT, setDrawT] = useState(0);
  const [drawDeck, setDrawDeck] = useState([]);
  const [drawPhase, setDrawPhase] = useState("idle");
  const drawTrigger = React.useRef(0);
  const recognitionRef = React.useRef(null);
  const [pullStyle, setPullStyle] = useState("dialogue");
  const [pullReading, setPullReading] = useState(null);
  const [pullLoading, setPullLoading] = useState(false);
  const [pullMode, setPullMode] = useState("manual");
  const [randomCard, setRandomCard] = useState(null);
  const [showReveal, setShowReveal] = useState(false);
  const [isNewPull, setIsNewPull] = useState(false);
  const [oracleOpen, setOracleOpen] = useState(false);
  const [oracleDateKey, setOracleDateKey] = useState(null);
  const [oracleThreads, setOracleThreads] = useState({});
  const [pullSaved, setPullSaved] = useState(false);
  const [suitsState, setSuitsState] = useState("idle"); // "idle" | "cycling"
  const [supabaseUser, setSupabaseUser] = useState(null); // authenticated Supabase user
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallInfo, setPaywallInfo] = useState(null);

  // Cycle suit icons on every tab change
  useEffect(() => {
    setSuitsState("cycling");
    const t = setTimeout(() => setSuitsState("idle"), 500);
    return () => clearTimeout(t);
  }, [activeTab]);

  // ── Rate limit event listener ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => { setPaywallInfo(e.detail); setPaywallVisible(true); };
    window.addEventListener("oracle-rate-limit", handler);
    return () => window.removeEventListener("oracle-rate-limit", handler);
  }, []);

  // ── Supabase auth listener ──────────────────────────────────────────────────
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const user = session?.user || null;
      setSupabaseUser(user);
      if (event === "SIGNED_IN" && user) {
        // Load cloud data into localStorage first
        await loadFromCloud(user.id);
        // Check if this user has a completed profile
        const hasProfile = !!localStorage.getItem("oracle_user");
        if (hasProfile) {
          // Returning user — go straight to app via flash
          setOnboardStep("login-flash");
        }
        // If no profile: stay in current onboarding step (they continue from email)
      } else if (event === "SIGNED_OUT") {
        setSupabaseUser(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line

  // ── Cloud sync — debounced, runs 2s after any significant state change ──────
  const cloudSyncTimer = useRef(null);
  useEffect(() => {
    if (!supabaseUser) return;
    clearTimeout(cloudSyncTimer.current);
    cloudSyncTimer.current = setTimeout(() => saveToCloud(supabaseUser.id), 2000);
  }, [pulls, onboardUser, contextProfile, resonanceMap, supabaseUser]);

  useEffect(() => {
    (async () => {
      const base = {};
      HISTORICAL_PULLS.forEach(p => { base[p.date] = p; });
      try {
        // If there's a live Supabase session, load cloud data first so localStorage is up to date
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setSupabaseUser(session.user);
          await loadFromCloud(session.user.id);
        }

        // Check for existing user — skip onboarding if found
        const userStored = await storage.get("oracle_user");
        const stored = await storage.get("oracle_pulls");
        const ctx = await storage.get("oracle_context");
        const prefs = await storage.get("oracle_prefs");
        setPulls(stored ? { ...base, ...JSON.parse(stored.value) } : base);
        if (ctx) { setContextProfile(ctx.value); setContextSaved(true); setContextEditing(false); }
        if (userStored) {
          const u = JSON.parse(userStored.value);
          setOnboardUser(u);
          setOnboardName(u.name||"");
          setOnboardDeck(u.deck||"playing");
          // Existing user — splash → login-flash → app
          setOnboardStep("splash");
          setTimeout(() => setOnboardStep("login-flash"), 1800);
        } else {
          // New user — show splash then welcome
          setTimeout(() => setOnboardStep("welcome"), 2200);
          setOnboardStep("splash");
        }
        if (prefs) {
          const p = JSON.parse(prefs.value);
          if (p.darkMode !== undefined) {
            setDarkMode(p.darkMode);
            document.documentElement.classList.toggle("dark", p.darkMode);
            document.body.classList.toggle("dark", p.darkMode);
          }
          if (p.defaultDeck) { setDefaultDeck(p.defaultDeck); setPullDeck(p.defaultDeck); }
          if (p.defaultStyle) { setDefaultStyle(p.defaultStyle); setPullStyle(p.defaultStyle); }
          try { const rm = await storage.get('oracle_resonance'); if (rm) setResonanceMap(JSON.parse(rm.value)); } catch {}
        }
      } catch {
        setPulls(base);
        // On error, show onboarding
        setTimeout(() => setOnboardStep("welcome"), 2200);
        setOnboardStep("splash");
      }
    })();
  }, []);

  const savePrefs = async (prefs) => {
    try { await storage.set("oracle_prefs", JSON.stringify(prefs)); } catch {}
  };

  const toggleDark = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle("dark", next);
    document.body.classList.toggle("dark", next);
    savePrefs({ darkMode: next, defaultDeck, defaultStyle });
  };

  const savePulls = async (updated) => {
    const u = {};
    Object.entries(updated).forEach(([date, pull]) => {
      if (!HISTORICAL_PULLS.find(h => h.date === date) || pull.reflection) u[date] = pull;
    });
    try { await storage.set("oracle_pulls", JSON.stringify(u)); } catch {}
  };

  const generateReading = async () => {
    if (!pullCard.trim()) return;
    setPullLoading(true);
    setPullReading(null);
    const styleMap = {
      whisper: "Respond in 3–5 lines. Poetic, sparse, intimate. No headers. Pure essence.",
      dialogue: "Respond in 2–3 short paragraphs. Personal and direct. No bullet points.",
      immersion: "Respond in a full narrative reading of 4–5 paragraphs. Rich, layered, personal."
    };
    const prompt = `${contextProfile}\n\nToday's date: ${getToday()}\nDeck: ${pullDeck === "playing" ? "Traditional playing cards" : pullDeck === "tarot" ? "Tarot" : "Oracle"}\nCard drawn: ${pullCard}\n${pullIntention ? `Intention: ${pullIntention}\n` : ""}\n${styleMap[pullStyle]}\n\nSpeak directly to the person. Make it personal, not generic. Draw on the context you know about their journey.`;
    // Token budget by style — whisper needs far fewer tokens than immersion
    const tokenBudget = pullStyle === "whisper" ? 150 : pullStyle === "dialogue" ? 350 : 600;
    try {
      const data = await callClaude(
        { model:"claude-sonnet-4-20250514", max_tokens:tokenBudget, messages:[{role:"user",content:prompt}] },
        "reading"
      );
      logSpend("generate-reading", "claude-sonnet-4-20250514", data.usage?.input_tokens||600, data.usage?.output_tokens||350);
      setPullReading(data.content?.filter(b=>b.type==="text").map(b=>b.text).join("") || "The cards are quiet today.");
    } catch { setPullReading("The veil is thick today. Try again shortly."); }
    setPullLoading(false);
  };

  // Shuffle 52 cards for ribbon animation
  function ribbonShuffle() {
    const SUITS2=["spades","hearts","diamonds","clubs"];
    const RANKS2=["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
    const d=SUITS2.flatMap(s=>RANKS2.map(r=>({rank:r,suit:s})));
    for(let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]];}
    return d;
  }

  const startDrawAnimation = () => {
    setPullIntention(offeringIntention);
    const freshDeck = ribbonShuffle();
    setDrawDeck(freshDeck);
    setDrawAnim("fading");
    setDrawPhase("idle");
    drawT0Ref.current = null;
    // After fade (600ms), start the ribbon animation
    setTimeout(() => {
      setDrawAnim("animating");
      setDrawPhase("intro");
      drawTrigger.current += 1;
    }, 600);
  };

  // RAF loop for the draw animation
  React.useEffect(() => {
    if (drawAnim !== "animating") {
      drawRafRef.current && cancelAnimationFrame(drawRafRef.current);
      drawT0Ref.current = null;
      if (drawAnim !== "revealing") setDrawT(0);
      return;
    }
    // Phase timings (seconds)
    const T_STREAM = 0.8;
    const GAP = 0.048;
    const TRAVEL = 1.6;
    const T_RETURN = T_STREAM + GAP*52 + TRAVEL;
    const T_FLIP = T_RETURN + 0.4;
    const T_FACE = T_FLIP + 1.8;
    const TOTAL = T_FACE + 0.8;

    const go = ts => {
      if (!drawT0Ref.current) drawT0Ref.current = ts;
      const el = (ts - drawT0Ref.current) / 1000;
      setDrawT(el);
      if      (el < T_STREAM) setDrawPhase("intro");
      else if (el < T_RETURN) setDrawPhase("stream");
      else if (el < T_FLIP)   setDrawPhase("return");
      else if (el < T_FACE)   setDrawPhase("flip");
      else if (el < TOTAL)    setDrawPhase("face");
      else {
        // Animation done — reveal card on home page, expand selector with card pre-selected
        setDrawPhase("done");
        setDrawAnim("revealing");
        setTimeout(() => {
          const picked = drawDeck[26] || drawDeck[0];
          const suitSym = picked.suit==="spades"?"♠":picked.suit==="hearts"?"♥":picked.suit==="diamonds"?"♦":"♣";
          const cardStr = picked.rank + suitSym;
          setPullCard(cardStr);
          setOfferingExpanded(true);
          setTimeout(() => {
            setDrawAnim("fadeout");
            setTimeout(() => {
              setDrawAnim(null);
              setDrawPhase("idle");
            }, 1000);
          }, 200);
        }, 1200);
        return;
      }
      drawRafRef.current = requestAnimationFrame(go);
    };
    drawRafRef.current = requestAnimationFrame(go);
    return () => cancelAnimationFrame(drawRafRef.current);
  }, [drawAnim, drawTrigger.current]);

  const savePull = async () => {
    const today = getToday();
    const entry = { date:today, card:pullCard, deck:pullDeck, reading:pullReading, intention:pullIntention, style:pullStyle, tags:[], time: new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) };
    const updated = { ...pulls, [today]: entry };
    setPulls(updated);
    await savePulls(updated);
    setPullSaved(true);
    setTimeout(() => {
      setIsNewPull(true);
      setActiveTab("home");
      setPullCard(""); setPullIntention(""); setPullReading(null);
      setPullSaved(false); setPullLoading(false);
      setPullOracleMessages([]); setOfferingIntention("");
      setOfferingExpanded(false);
      setTimeout(() => setIsNewPull(false), 4000);
    }, 1200);
  };

  const sendPullOracleMessage = async () => {
    const text = pullOracleInput.trim();
    if (!text || pullOracleLoading) return;
    setPullOracleInput("");
    const userMsg = { role:"user", content: text };
    const newMsgs = [...pullOracleMessages, userMsg];
    setPullOracleMessages(newMsgs);
    setPullOracleLoading(true);
    // Use todayPull as source when coming from reading tab, pullCard/pullReading when from fresh pull
    const sourceCard = pullCard || todayPull?.card || "";
    const sourceDeck = pullDeck || todayPull?.deck || "playing";
    const sourceIntention = pullIntention || todayPull?.intention || "";
    const sourceReading = pullReading || todayPull?.reading || "";
    const system = `${contextProfile}

You are the Oracle, a daily divination companion. You just gave a reading for this card pull.
Card: ${sourceCard} (${sourceDeck})
${sourceIntention ? `Intention: ${sourceIntention}` : ""}
Reading given: ${sourceReading}

Continue the conversation. Be direct, grounded, poetic when the card demands it. No flattery.`;
    try {
      const data = await callClaude({
          model: newMsgs.length <= 4 ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-20250514",
          max_tokens: 300,
          system,
          messages: newMsgs.slice(-6).map(m=>({role:m.role,content:m.content}))
        }, "chat");
      const usedModel = newMsgs.length <= 4 ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-20250514";
      logSpend("reading-chat", usedModel, data.usage?.input_tokens||500, data.usage?.output_tokens||180);
      const reply = data.content?.find(b=>b.type==="text")?.text || "";
      setPullOracleMessages([...newMsgs, { role:"assistant", content:reply }]);
    } catch {
      setPullOracleMessages([...newMsgs, { role:"assistant", content:"Lost the signal." }]);
    }
    setPullOracleLoading(false);
  };

  const saveIntake = async () => {
    if (!intakeDate || !intakeCard.trim()) return;
    const entry = {
      date: intakeDate,
      card: intakeCard.trim(),
      deck: intakeDeck,
      reading: intakeNote.trim(),
      tags: [],
      // No auto-time on backdated entries — time unknown
    };
    const updated = { ...pulls, [intakeDate]: entry };
    setPulls(updated);
    await savePulls(updated);
    setIntakeCard("");
    setIntakeDate("");
    setIntakeNote("");
    setIntakeSaved(true);
    setTimeout(() => setIntakeSaved(false), 2400);
  };

  const RESONANCE_WORDS = ["unsettling","unclear","present","resonant","electric"];

  const saveResonance = async (date, idx) => {
    const updated = { ...resonanceMap, [date]: idx };
    setResonanceMap(updated);
    try { await storage.set("oracle_resonance", JSON.stringify(updated)); } catch {}
  };

  const saveReflection = async (date) => {
    if (!reflectionDraft.trim()) return;
    const updated = { ...pulls, [date]: { ...pulls[date], reflection:reflectionDraft } };
    setPulls(updated);
    await savePulls(updated);
    setSelectedEntry({ ...selectedEntry, reflection:reflectionDraft });
  };

  // Open entry with ghost card animation
  // e = click event (to get card position), pull = the entry, fromSize = source card size
  const openEntry = (e, pull, fromSize = 36) => {
    setReflectionDraft(pull.reflection || "");
    // Find the card element near the click target
    const cardEl = e.currentTarget.querySelector("svg, [data-card]") || e.currentTarget;
    const rect = cardEl.getBoundingClientRect();
    setGhostCard({ rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, pull, fromSize, phase: "flying" });
    // Phase to resting after animation completes
    setTimeout(() => setGhostCard(g => g ? {...g, phase: "resting"} : null), 350);
    // Show modal content shortly after ghost starts flying
    setTimeout(() => setSelectedEntry(pull), 80);
  };

  const closeEntry = () => {
    if (ghostCard) {
      setGhostCard(g => g ? {...g, phase: "returning"} : null);
      setTimeout(() => setGhostCard(null), 320);
    }
    setSelectedEntry(null);
  };

  const today = getToday();
  const todayPull = pulls[today];

  const renderCalendar = () => {
    const firstDay = getFirstDayOfMonth(calYear, calMonth);
    const daysInMonth = getDaysInMonth(calYear, calMonth);
    const daysInPrev = getDaysInMonth(calYear, calMonth === 0 ? 11 : calMonth - 1);
    const cells = [];
    for (let i = firstDay-1; i >= 0; i--) {
      const d=daysInPrev-i, m=calMonth===0?11:calMonth-1, y=calMonth===0?calYear-1:calYear;
      cells.push({day:d,dateStr:`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`,other:true});
    }
    for (let d=1; d<=daysInMonth; d++) cells.push({day:d,dateStr:`${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`,other:false});
    for (let d=1; cells.length<42; d++) {
      const m=calMonth===11?0:calMonth+1, y=calMonth===11?calYear+1:calYear;
      cells.push({day:d,dateStr:`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`,other:true});
    }
    return (
      <div>
        <div className="cal-nav">
          <button className="cal-nav-btn" onClick={()=>{if(calMonth===0){setCalMonth(11);setCalYear(calYear-1);}else setCalMonth(calMonth-1);}}>Prev</button>
          <div className="cal-month">{MONTHS[calMonth]} {calYear}</div>
          <button className="cal-nav-btn" onClick={()=>{if(calMonth===11){setCalMonth(0);setCalYear(calYear+1);}else setCalMonth(calMonth+1);}}>Next</button>
        </div>
        <div className="cal-grid">
          {DAYS_SHORT.map(d=><div key={d} className="cal-day-header">{d}</div>)}
          {cells.map(({day,dateStr,other})=>{
            const pull=pulls[dateStr], isToday=dateStr===today;
            const rot = pull ? cardRotation(dateStr, 22) : 0;
            return (
              <div key={dateStr} className={`cal-cell ${other?"other-month":""} ${pull?"has-pull":""} ${isToday?"today":""}`}
                onClick={e=>{if(pull) openEntry(e,pull,38);}}
                style={isToday ? {
                  background: pull ? suitColor(pull.card) : "var(--red-suit)",
                } : {}}>
                <div className="cal-date" style={isToday ? {color:"#fff", textAlign:"center", width:"100%"} : {}}>{day}</div>
                {pull ? (() => {
                  const hashV = dateStr.split("").reduce((h,c)=>((h<<5)-h+c.charCodeAt(0))|0, 0);
                  const vOff = ((Math.abs(hashV) % 14) - 4);
                  const hOff = ((Math.abs(hashV >> 3) % 8) - 4);
                  return (
                    <div style={{
                      position:"absolute",
                      top:`calc(50% + ${vOff}px)`,
                      left:`calc(50% + ${hOff}px)`,
                      transform:`translate(-50%,-50%) rotate(${rot}deg)`,
                      zIndex: 2,
                      filter:"drop-shadow(0 3px 8px rgba(0,0,0,0.18))",
                    }}>
                      <SmartCard cardStr={pull.card} size={38}/>
                    </div>
                  );
                })() : isToday ? (
                  <div style={{
                    position:"absolute", inset:0,
                    display:"flex", flexDirection:"column",
                    alignItems:"center", justifyContent:"flex-end",
                    paddingBottom:"8px",
                    gap:"3px", cursor:"pointer",
                  }} onClick={e=>{e.stopPropagation(); setActiveTab("pull");}}>
                    <span style={{
                      fontFamily:"'Montserrat',sans-serif",fontSize:"6px",
                      letterSpacing:"0.16em",textTransform:"uppercase",
                      color:"#fff",fontWeight:600,lineHeight:1,
                    }}>pull</span>
                    <SuitIcon suit="diamond" size={13} style={{color:"#fff",opacity:1}}/>
                    <span style={{
                      fontFamily:"'Montserrat',sans-serif",fontSize:"6px",
                      letterSpacing:"0.16em",textTransform:"uppercase",
                      color:"#fff",fontWeight:600,lineHeight:1,
                    }}>card</span>
                  </div>
                ) : (
                  /* Empty non-today cell — greyed diamond, always visible, tap to pull */
                  <div style={{
                    position:"absolute", inset:0,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    cursor:"pointer",
                  }}
                    className="cal-empty-cell"
                    onClick={e=>{e.stopPropagation(); setActiveTab("pull");}}
                  >
                    <SuitIcon suit="diamond" size={12} style={{color:"var(--silver)", opacity:0.35}}/>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTimeline = () => {
    const today = getToday();
    // Get all pull dates as a Set for quick lookup
    const pullDates = new Set(Object.keys(pulls));
    // Build date range: from earliest pull to today
    const allPullDates = Object.keys(pulls).sort();
    if (allPullDates.length === 0) return <div style={{padding:"40px 0",textAlign:"center",color:"var(--ash)",fontFamily:"var(--font-mono)",fontSize:"11px",letterSpacing:"0.1em"}}>no pulls yet</div>;
    const startDate = allPullDates[0];
    // Build every day from start to today
    const allDays = [];
    const d = new Date(startDate + "T12:00:00");
    const end = new Date(today + "T12:00:00");
    while (d <= end) {
      allDays.push(d.toISOString().split("T")[0]);
      d.setDate(d.getDate() + 1);
    }
    // Group by month, newest first
    const grouped = {};
    [...allDays].reverse().forEach(dateStr => {
      const [y,m] = dateStr.split("-");
      const k = `${y}-${m}`;
      if (!grouped[k]) grouped[k] = [];
      grouped[k].push(dateStr);
    });
    return (
      <div>
        {Object.entries(grouped).map(([key, dates]) => {
          const [y,m] = key.split("-");
          return (
            <div key={key}>
              <div className="timeline-month-label">{MONTHS[parseInt(m)-1]} {y}</div>
              {dates.map(dateStr => {
                const pull = pulls[dateStr];
                if (pull) {
                  // Normal pull entry
                  return (
                    <div key={dateStr} className="timeline-entry" onClick={e=>openEntry(e,pull,48)}>
                      <div style={{display:"flex",justifyContent:"center"}}>
                        <div className="card-skew" style={{transform:`rotate(${cardRotation(dateStr, 20)}deg)`}}>
                          <SmartCard cardStr={pull.card} size={48}/>
                        </div>
                      </div>
                      <div style={{minWidth:0}}>
                        <div style={{display:"flex",alignItems:"baseline",gap:"10px",flexWrap:"wrap"}}>
                          <CardTitle cardStr={pull.card} className="timeline-card-name" style={{fontSize:"26px"}}/>
                          <div className="timeline-meta">{formatDateShort(dateStr)}{pull.time ? ` · ${pull.time}` : ""}</div>
                        </div>
                        <div className="timeline-preview">{pull.intention?`"${pull.intention}" — `:""}{pull.reading}</div>
                      </div>
                      <div className="timeline-arrow">→</div>
                    </div>
                  );
                } else {
                  // Empty day — compact row with greyed diamond + date + pull card link
                  return (
                    <div key={dateStr} className="timeline-empty-day"
                      onClick={()=>setActiveTab("pull")}
                    >
                      <SuitIcon suit="diamond" size={11} style={{color:"var(--silver)",opacity:0.35,flexShrink:0}}/>
                      <div style={{
                        fontFamily:"var(--font-mono)",fontSize:"9px",
                        letterSpacing:"0.12em",textTransform:"uppercase",
                        color:"var(--silver)",opacity:0.5,
                      }}>{formatDateShort(dateStr)}</div>
                      <div style={{
                        marginLeft:"auto",
                        fontFamily:"'Montserrat',sans-serif",fontSize:"7px",
                        letterSpacing:"0.14em",textTransform:"uppercase",
                        color:"var(--silver)",opacity:0.35,
                      }}>pull card →</div>
                    </div>
                  );
                }
              })}
            </div>
          );
        })}
      </div>
    );
  };

  const drawRandom = () => {
    const deck = pullDeck === "tarot" ? TAROT_DECK : PLAYING_DECK;
    const shuffled = shuffleDeck(deck);
    const drawn = shuffled[0];
    setRandomCard(drawn);
    setShowReveal(true);
  };

  const renderPullForm = () => {
    const selectedSuit = pullCard && !pullCard.startsWith("?") ? parseCard(pullCard)?.suit : (pullCard?.startsWith("?") ? Object.keys({spades:"♠",hearts:"♥",diamonds:"♦",clubs:"♣"}).find(k => pullCard.includes({spades:"♠",hearts:"♥",diamonds:"♦",clubs:"♣"}[k])) : null);
    const selectedRank = pullCard && !pullCard.startsWith("?") ? parseCard(pullCard)?.rank : null;

    const suits = [
      { key:"spades",   sym:"spade",   red:false },
      { key:"diamonds", sym:"diamond", red:true  },
      { key:"clubs",    sym:"club",    red:false },
      { key:"hearts",   sym:"heart",   red:true  },
    ];
    const SUIT_SYM = { spades:"♠", hearts:"♥", diamonds:"♦", clubs:"♣" };
    const allRanks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

    const selectRank = (rank) => {
      if (!selectedSuit) { setPullCard(rank + "?"); return; }
      setPullCard(rank + SUIT_SYM[selectedSuit]);
    };
    const selectSuit = (suitKey) => {
      const sym = SUIT_SYM[suitKey];
      if (selectedRank) setPullCard(selectedRank + sym);
      else setPullCard("?" + sym);
    };

    // Derive clean card string — only valid if both suit and rank known
    const hasValidCard = selectedSuit && selectedRank;

    return (
    <div className="pull-form" style={{animation: drawAnim==="fadeout" ? "drawFadeIn 0.8s ease 0.3s both" : undefined}}>
      {pullLoading && <LoadingScreen card={pullCard} />}

      {!pullReading ? (
        <>
          {/* Universal page header */}
          <PageHeader
            title="pull your card"
            sub="name what the cards revealed."
          />

          {/* Oracle choose CTA — triggers the draw animation */}
          <button className="offering-cta" style={{marginBottom:"32px"}}
            onClick={startDrawAnimation}>
            <SuitIcon suit="spade"   size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
            <SuitIcon suit="diamond" size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
            let the oracle choose
            <SuitIcon suit="club"    size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
            <SuitIcon suit="heart"   size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
          </button>

          {/* Inline intention */}
          <div className="pull-intention-row">
            <textarea
              className="pull-intention-text"
              rows={1}
              placeholder="State your intention or question…"
              value={pullIntention}
              onChange={e => setPullIntention(e.target.value)}
            />
            <button className="pull-intention-edit">edit</button>
          </div>

          {/* Eyebrow — centered, mysterious */}
          <div style={{
            fontFamily:"'Montserrat',sans-serif", fontSize:"7px",
            letterSpacing:"0.28em", textTransform:"uppercase",
            color:"var(--silver)", fontWeight:500,
            textAlign:"center", marginBottom:"16px",
          }}>drawn by your own hand</div>

          {/* Unified card selector — suits then all ranks together */}
          <div className="pull-suit-grid" style={{marginBottom:"8px"}}>
            {suits.map(({ key, sym, red }) => {
              const isSelected = selectedSuit === key;
              return (
                <button
                  key={key}
                  className={`pull-suit-btn ${isSelected ? (red ? "selected-red" : "selected") : ""}`}
                  onClick={() => selectSuit(key)}
                >
                  <SuitIcon
                    suit={sym}
                    size={28}
                    style={{color: isSelected ? "#fff" : red ? "var(--red-suit)" : "var(--ink)"}}
                  />
                </button>
              );
            })}
          </div>

          {/* All 13 ranks in one grid */}
          <div style={{
            display:"grid", gridTemplateColumns:"repeat(13,1fr)",
            gap:"4px", marginBottom:"32px",
          }}>
            {allRanks.map(r => (
              <button
                key={r}
                className={`pull-rank-btn ${selectedRank===r?"selected":""}`}
                style={{padding:"10px 2px", fontSize:"13px"}}
                onClick={() => selectRank(r)}
              >{r}</button>
            ))}
          </div>

          {/* Reading depth */}
          <div className="form-field">
            <label className="form-label">Reading Depth</label>
            <div className="style-chips">
              {[["whisper","Whisper","3-5 lines"],["dialogue","Dialogue","2-3 paragraphs"],["immersion","Immersion","Full narrative"]].map(([v,n,d])=>(
                <div key={v} className={`style-chip ${pullStyle===v?"selected":""}`} onClick={()=>setPullStyle(v)}>
                  <div className="style-chip-name">{n}</div>
                  <div className="style-chip-desc">{d}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Receive reading CTA */}
          <button
            className="pull-receive-btn"
            disabled={!hasValidCard || pullLoading}
            onClick={generateReading}
          >
            <SuitIcon suit="diamond" size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
            receive your reading
            <SuitIcon suit="diamond" size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
          </button>

          {/* Back */}
          <button className="back-btn" style={{margin:"20px auto 0",display:"flex",justifyContent:"center"}}
            onClick={()=>{ setActiveTab("home"); setPullReading(null); setPullCard(""); setPullIntention(""); setRandomCard(null); setShowReveal(false); }}>
            ← back
          </button>
        </>
      ) : (
        /* ── IMMERSIVE READING SCREEN ── */
        <div className="reading-screen" style={{margin:"0 -24px",padding:"0"}}>

          {/* Sticky mini-header — timeline entry style, slides down from top */}
          <div className={`reading-sticky ${chatExpanded?"visible":""}`}>
            {/* Left: card thumbnail rotated like timeline */}
            <div style={{display:"flex",justifyContent:"center"}}>
              <div className="card-skew reading-sticky-card"
                style={{transform:`rotate(${cardRotation(today,4)}deg)`}}>
                <SmartCard cardStr={pullCard} size={42}/>
              </div>
            </div>
            {/* Center: card name + date + reading preview */}
            <div className="reading-sticky-text" style={{minWidth:0}}>
              <CardTitle cardStr={pullCard}
                className="reading-sticky-name timeline-card-name"
                style={{fontSize:"20px"}}/>
              <div className="timeline-meta" style={{fontSize:"13px",marginTop:"2px"}}>
                {formatDateShort(today)}{pullIntention ? ` · "${pullIntention.substring(0,20)}${pullIntention.length>20?"…":""}"` : ""}
              </div>
              <div className="timeline-preview" style={{marginTop:"4px"}}>
                {pullReading ? pullReading.substring(0,80)+"…" : ""}
              </div>
            </div>
            {/* Right: collapse chat button */}
            <button style={{
              background:"none",border:"none",cursor:"pointer",
              color:"var(--silver)",fontSize:"20px",padding:"4px 0",
              fontFamily:"var(--font-display)",fontWeight:300,
              flexShrink:0,
              transition:"color 0.15s, transform 0.2s",
            }}
              onClick={()=>setChatExpanded(false)}>↓</button>
          </div>

          {/* Hero card — floats, collapses when chat expands */}
          <div className={`reading-hero ${chatExpanded?"collapsed":""}`}>
            <div className="reading-card-label">
              {formatDateShort(today)} · {pullDeck}
            </div>
            <div className="reading-card-hero">
              <SmartCard cardStr={pullCard} size={200}/>
            </div>
            <div className="reading-card-name">
              <CardTitle cardStr={pullCard} iconSize={28}/>
            </div>
            {pullIntention&&(
              <div className="reading-intention">"{pullIntention}"</div>
            )}
          </div>

          {/* Reading body */}
          {pullReading&&(
            <div className="reading-body">
              {pullReading.split("\n\n").map((p,i)=><p key={i}>{p}</p>)}
            </div>
          )}

          {/* Chat section */}
          <div className="reading-chat">

            {/* Chat header — tap to open */}
            <div className="reading-chat-header" onClick={()=>setChatExpanded(v=>!v)}>
              <SuitIcon suit="diamond" size={10} style={{color:"var(--red-suit)"}}/>
              <span>Ask the Oracle</span>
              {pullOracleMessages.length>0&&(
                <span style={{
                  background:"var(--red-suit)",color:"white",
                  fontSize:"7px",fontFamily:"'Montserrat',sans-serif",
                  fontWeight:600,letterSpacing:"0.1em",
                  padding:"2px 6px",borderRadius:"10px",
                  lineHeight:1.4,
                }}>
                  {Math.ceil(pullOracleMessages.length/2)}
                </span>
              )}
              <SuitIcon suit="diamond" size={10} style={{color:"var(--red-suit)",marginLeft: pullOracleMessages.length>0 ? 0 : "auto"}}/>
              <span style={{
                marginLeft:"auto",
                fontFamily:"var(--font-display)",fontSize:"22px",
                fontWeight:300,color:"var(--silver)",
                transform: chatExpanded ? "rotate(180deg)" : "rotate(0deg)",
                transition:"transform 0.35s cubic-bezier(0.34,1.56,0.64,1)",
                display:"inline-block",
              }}>↓</span>
            </div>

            {/* Messages */}
            {(chatExpanded||pullOracleMessages.length>0)&&(
              <div className="chat-messages" ref={chatMessagesRef}
                style={{
                  maxHeight: chatExpanded ? "55vh" : "none",
                  overflowY: chatExpanded ? "auto" : "visible",
                  scrollBehavior: "smooth",
                }}>
                {pullOracleMessages.length===0&&(
                  <div className="chat-bubble-row" style={{animation:"bubbleIn 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.2s both"}}>
                    <div className="chat-avatar oracle">
                      <StarGlyph size={12} color="currentColor"/>
                    </div>
                    <div className="chat-bubble oracle">
                      {pullIntention
                        ? `Your intention was to ${pullIntention.toLowerCase()}. What's landing for you in this card?`
                        : `What's stirring as you sit with this card? I'm here to go deeper with you.`
                      }
                    </div>
                  </div>
                )}
                {pullOracleMessages.map((msg,i)=>(
                  <div key={i} className={`chat-bubble-row ${msg.role==="user"?"user":""}`}>
                    {msg.role==="assistant"&&(
                      <div className="chat-avatar oracle">
                        <StarGlyph size={12} color="currentColor"/>
                      </div>
                    )}
                    <div className={`chat-bubble ${msg.role==="user"?"user":"oracle"}`}
                      style={{whiteSpace:"pre-wrap"}}>
                      {msg.content}
                    </div>
                    {msg.role==="user"&&(
                      <div className="chat-avatar">
                        {(contextProfile?.name||"B")[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                ))}
                {pullOracleLoading&&(
                  <div className="chat-bubble-row">
                    <div className="chat-avatar oracle"><StarGlyph size={12} color="currentColor"/></div>
                    <div className="chat-bubble oracle">
                      <div className="typing-dots">
                        <div className="typing-dot"/><div className="typing-dot"/><div className="typing-dot"/>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Spacer for fixed bottom bars */}
          <div style={{height:"130px"}}/>
        </div>
      )}

      {/* Fixed save button */}
      {pullReading&&(
        <div className={`reading-save-btn ${chatExpanded?"hidden":""}`}>
          <button className="reading-save-btn-inner" onClick={savePull} disabled={pullSaved}>
            <SuitIcon suit="diamond" size={11} style={{color:"currentColor",opacity:0.7}}/>
            {pullSaved?"Saved to the Observatory ✓":"Save to the Observatory"}
            <SuitIcon suit="diamond" size={11} style={{color:"currentColor",opacity:0.7}}/>
          </button>
          {!pullSaved&&(
            <button className="context-btn" style={{display:"block",width:"100%",textAlign:"center",marginTop:"8px",padding:"10px",fontSize:"11px"}}
              onClick={()=>{ setPullReading(null); setPullIntention(""); setPullOracleMessages([]); setChatExpanded(false); }}>
              pull again
            </button>
          )}
        </div>
      )}

      {/* Fixed chat input row */}
      {pullReading&&(
        <div className={`reading-input-row ${chatExpanded?"":"hidden"}`}>
          <button className={`chat-mic-btn ${chatRecording?"active":""}`}
            onClick={()=>{
              const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
              if(!SR)return;
              if(chatRecording){chatRecognitionRef.current&&chatRecognitionRef.current.stop();setChatRecording(false);return;}
              const r=new SR();r.continuous=true;r.interimResults=true;r.lang="en-US";
              let final=pullOracleInput;
              r.onresult=e=>{let interim="";for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)final+=(final?" ":"")+e.results[i][0].transcript;else interim+=e.results[i][0].transcript;}setPullOracleInput(final+(interim?" "+interim:""));};
              r.onend=()=>{setChatRecording(false);setPullOracleInput(final);};
              r.onerror=()=>setChatRecording(false);
              chatRecognitionRef.current=r;r.start();setChatRecording(true);
            }}>
            {chatRecording?(
              <svg width="14" height="14" viewBox="0 0 14 14" fill="white"><rect x="2" y="2" width="10" height="10" rx="2"/></svg>
            ):(
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="12" rx="3"/>
                <path d="M5 10a7 7 0 0 0 14 0"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            )}
          </button>
          <textarea className="reading-chat-input"
            value={pullOracleInput}
            onChange={e=>setPullOracleInput(e.target.value)}
            onFocus={()=>setChatExpanded(true)}
            onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendPullOracleMessage();} }}
            placeholder="Ask the Oracle anything..."
            rows={1}/>
          <button className="chat-send-btn" onClick={sendPullOracleMessage}
            disabled={!pullOracleInput.trim()||pullOracleLoading}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      )}

    </div>
  );
  };

  // Oracle tab now renders OraclePage inline — unified chat interface
  const renderReading = () => {
    if (!todayPull) { setActiveTab("pull"); return null; }
    const userInitial = (onboardUser?.name || onboardName || "?")[0].toUpperCase();
    return (
      <div className="fi">

        {/* Page header */}
        <PageHeader
          title="the oracle"
          sub="your reading for today."
          onMenu={()=>setActiveTab("home")}
        />

        {/* Card + meta context strip */}
        <div style={{
          display:"flex", alignItems:"center", gap:"16px",
          padding:"20px 0 20px", borderBottom:"1px solid var(--rule)",
          marginBottom:"24px",
        }}>
          <div style={{flexShrink:0, transform:`rotate(${cardRotation(todayPull.date,4)}deg)`}}>
            <SmartCard cardStr={todayPull.card} size={64}/>
          </div>
          <div style={{minWidth:0}}>
            <div style={{fontFamily:"var(--font-mono)",fontSize:"7px",letterSpacing:"0.22em",
              textTransform:"uppercase",color:"var(--silver)",marginBottom:"4px"}}>
              {formatDate(todayPull.date)}
            </div>
            <CardTitle cardStr={todayPull.card} style={{fontSize:"32px"}}/>
            {todayPull.intention && (
              <div style={{fontFamily:"var(--font-body)",fontSize:"14px",
                fontStyle:"italic",color:"var(--ash)",marginTop:"3px",
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                "{todayPull.intention}"
              </div>
            )}
          </div>
        </div>

        {/* Reading as the first oracle message */}
        {todayPull.reading && (
          <div className="oracle-msg" style={{marginBottom:"20px"}}>
            <div className="oracle-msg-avatar">
              <StarGlyph size={13} color="currentColor"/>
            </div>
            <div className="oracle-msg-bubble" style={{whiteSpace:"pre-wrap",fontSize:"16px",lineHeight:1.85}}>
              {todayPull.reading}
            </div>
          </div>
        )}

        {/* Empty state prompt */}
        {pullOracleMessages.length === 0 && !pullOracleLoading && (
          <div style={{
            fontFamily:"var(--font-mono)", fontSize:"7px",
            letterSpacing:"0.22em", textTransform:"uppercase",
            color:"var(--silver)", textAlign:"center",
            padding:"12px 0 20px",
          }}>
            ask anything · go deeper · begin
          </div>
        )}

        {/* Conversation thread */}
        <div style={{display:"flex",flexDirection:"column",gap:"14px",paddingBottom:"140px"}}>
          {pullOracleMessages.map((msg,i) => (
            <div key={i} className={`oracle-msg ${msg.role==="user"?"user":""}`}>
              <div className="oracle-msg-avatar">
                {msg.role==="assistant"
                  ? <StarGlyph size={13} color="currentColor"/>
                  : <span style={{fontSize:"11px",fontWeight:500}}>{userInitial}</span>
                }
              </div>
              <div className="oracle-msg-bubble" style={{whiteSpace:"pre-wrap",fontSize:"15px",lineHeight:1.75}}>
                {msg.content}
              </div>
            </div>
          ))}

          {/* Suit blink thinking indicator — replaces dots */}
          {pullOracleLoading && (
            <div className="oracle-thinking">
              <div className="oracle-thinking-suit">
                <SuitIcon suit="spade"   size={14} style={{color:"var(--ink)"}}/>
              </div>
              <div className="oracle-thinking-suit">
                <SuitIcon suit="diamond" size={14} style={{color:"var(--red-suit)"}}/>
              </div>
              <div className="oracle-thinking-suit">
                <SuitIcon suit="club"    size={14} style={{color:"var(--ink)"}}/>
              </div>
              <div className="oracle-thinking-suit">
                <SuitIcon suit="heart"   size={14} style={{color:"var(--red-suit)"}}/>
              </div>
            </div>
          )}

          {/* 4 suits always visible below last message when not loading */}
          {!pullOracleLoading && (pullOracleMessages.length > 0 || todayPull.reading) && (
            <div style={{
              display:"flex", gap:"14px", alignItems:"center", justifyContent:"center",
              padding:"8px 0 0", opacity:0.18,
            }}>
              <SuitIcon suit="spade"   size={12} style={{color:"var(--ink)"}}/>
              <SuitIcon suit="diamond" size={12} style={{color:"var(--red-suit)"}}/>
              <SuitIcon suit="club"    size={12} style={{color:"var(--ink)"}}/>
              <SuitIcon suit="heart"   size={12} style={{color:"var(--red-suit)"}}/>
            </div>
          )}
        </div>

        {/* Fixed input bar — sits above bottom nav */}
        <div className="oracle-input-row">
          <textarea
            className="oracle-input"
            value={pullOracleInput}
            onChange={e=>setPullOracleInput(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendPullOracleMessage();} }}
            placeholder="Ask the oracle anything…"
            rows={1}
            autoFocus
          />
          <button className="oracle-send"
            onClick={sendPullOracleMessage}
            disabled={!pullOracleInput.trim()||pullOracleLoading}>
            {/* Spade rotated 90° — points right like an arrow */}
            <SuitIcon suit="spade" size={16} style={{
              color:"#fff",
              transform:"rotate(90deg)",
              display:"block",
            }}/>
          </button>
        </div>
      </div>
    );
  };

  const renderVeil = () => <OblivionProGate dark={darkMode}/>;

  const renderOracle = () => (
    <OraclePage
      pulls={pulls}
      contextProfile={contextProfile}
      today={today}
      onNavigateToDay={(pull) => { setReflectionDraft(pull.reflection||""); setSelectedEntry(pull); }}
    />
  );


  const renderModal = () => {
    if (!selectedEntry) return null;
    const paragraphs = selectedEntry.reading?.split("\n\n").filter(Boolean) || [];
    const cardSize = 80;
    return (
      <div className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget) closeEntry();}}>
        <div className="modal">
          <button className="modal-close" onClick={closeEntry}>close ×</button>

          {/* Card anchored to top-left corner of modal, hovering over edge */}
          <div className="modal-card-anchor" onClick={closeEntry}
            style={{transform:`rotate(${cardRotation(selectedEntry.date,4)}deg)`}}>
            <SmartCard cardStr={selectedEntry.card} size={cardSize}/>
          </div>

          {/* Centered header, date + card name */}
          <div className="modal-header">
            <div className="modal-eyebrow">{formatDate(selectedEntry.date)} · {selectedEntry.deck}</div>
<CardTitle cardStr={selectedEntry.card} className="modal-card-title" style={{fontSize:"42px"}}/>
          </div>

          {selectedEntry.intention && (
            <div style={{fontFamily:"var(--font-body)",fontSize:"14px",color:"var(--ash)",marginBottom:"16px",textAlign:"center"}}>
              "{selectedEntry.intention}"
            </div>
          )}

          <hr className="modal-rule"/>

          <div className="modal-reading modal-reading-wrap">
            {paragraphs.map((p, i) => (
              <p key={i} className="modal-reading-line" style={{animationDelay:`${100 + i * 90}ms`}}>{p}</p>
            ))}
          </div>

          {selectedEntry.tags?.length > 0 && (
            <div style={{marginTop:"16px"}}>
              {selectedEntry.tags.map(t => <span key={t} className="tag-pill">{t}</span>)}
            </div>
          )}

          {/* Resonance module */}
          {(() => {
            const words = ["unsettling","unclear","present","resonant","electric"];
            const isRed = [3,4]; // resonant + electric glow red
            const cur = resonanceMap[selectedEntry.date] ?? null;
            const pct = cur !== null ? (cur / (words.length - 1)) * 100 : 0;
            const red = cur !== null && isRed.includes(cur);
            return (
              <div className="resonance-module">
                <div className="resonance-label">did this feel aligned?</div>
                <div className="resonance-words">
                  {words.map((w, i) => (
                    <div key={w}
                      className={`resonance-word ${cur===i?"active":""} ${cur===i&&isRed.includes(i)?"red":""}`}
                      onClick={()=>saveResonance(selectedEntry.date, i)}>
                      {w}
                    </div>
                  ))}
                </div>
                {cur !== null && (
                  <div className="resonance-slider-wrap">
                    <div className={`resonance-slider-fill ${red?"red":""}`} style={{width:`${pct}%`}}/>
                    <div className={`resonance-thumb ${red?"red":""}`} style={{left:`${pct}%`}}/>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="modal-reflection">
            <div className="modal-reflection-label">Reflection</div>
            <textarea placeholder="What resonated? What surprised you? How did it land?" value={reflectionDraft} onChange={e=>setReflectionDraft(e.target.value)}/>
            <button className="modal-save-btn" onClick={()=>saveReflection(selectedEntry.date)}>Save Reflection</button>
          </div>

          <button className="oracle-open-btn" style={{marginTop:"8px"}}
            onClick={()=>{ closeEntry(); setActiveTab("oracle"); }}>
            <SuitIcon suit="diamond" size={11} style={{color:"currentColor", opacity:0.6}}/>
            Ask the Oracle about this card
            <SuitIcon suit="diamond" size={11} style={{color:"currentColor", opacity:0.6}}/>
          </button>
        </div>
      </div>
    );
  };

  const renderGhostCard = () => {
    if (!ghostCard) return null;
    const { rect, pull, phase } = ghostCard;

    // Target: top-left corner of the modal
    // Modal is centered, max 540px, 24px from edges, offset -20px left / -28px top from modal edge
    const targetSize = 80; // matches modal-card-anchor size
    const vw = window.innerWidth;
    const modalW = Math.min(540, vw - 48);
    const modalLeft = (vw - modalW) / 2;
    const targetX = modalLeft - 20; // matches .modal-card-anchor left:-20px
    const targetY = window.innerHeight / 2 - 240 - 28; // approx modal top, anchor top:-28px

    const targetH = Math.round(targetSize * 1.4);
    const startScaleX = rect.w / targetSize;
    const startScaleY = rect.h / targetH;
    const startScale = Math.max(startScaleX, startScaleY, 0.3);
    const startTX = (rect.x + rect.w/2) - (targetX + targetSize/2);
    const startTY = (rect.y + rect.h/2) - (targetY + targetH/2);
    const isAtSource = phase === "flying" || phase === "returning";

    return (
      <div
        className={`ghost-card ${phase}`}
        onClick={phase === "resting" ? closeEntry : undefined}
        style={{
          left: targetX, top: targetY,
          width: targetSize, height: targetH,
          transform: isAtSource
            ? `translate(${startTX}px,${startTY}px) scale(${phase==="returning" ? startScale*0.6 : startScale})`
            : `translate(0,0) scale(1)`,
          opacity: phase === "returning" ? 0 : 1,
          pointerEvents: phase === "resting" ? "auto" : "none",
          cursor: phase === "resting" ? "pointer" : "default",
          display: phase === "resting" ? "none" : "block", // hide ghost when modal card-anchor is visible
        }}
      >
        <SmartCard cardStr={pull.card} size={targetSize}/>
      </div>
    );
  };

  const renderSettings = () => (
    <div className="settings-page fi">
      <PageHeader title="settings" sub="your practice, your way."/>

      {/* Appearance */}
      <div className="settings-section">
        <div className="settings-section-title">Appearance</div>
        <div className="settings-row">
          <span className="settings-label">Dark Mode</span>
          <div className={`toggle-switch ${darkMode?"on":""}`} onClick={toggleDark}>
            <div className="toggle-knob"/>
          </div>
        </div>
      </div>

      {/* Reading Defaults */}
      <div className="settings-section">
        <div className="settings-section-title">Reading Defaults</div>
        <div className="settings-row">
          <span className="settings-label">Default Deck</span>
          <select className="settings-select" value={defaultDeck} onChange={e=>{
            setDefaultDeck(e.target.value); setPullDeck(e.target.value);
            savePrefs({darkMode, defaultDeck:e.target.value, defaultStyle});
          }}>
            <option value="playing">Playing Cards</option>
            <option value="tarot">Tarot</option>
            <option value="oracle">Oracle</option>
          </select>
        </div>
        <div className="settings-row">
          <span className="settings-label">Reading Depth</span>
          <select className="settings-select" value={defaultStyle} onChange={e=>{
            setDefaultStyle(e.target.value); setPullStyle(e.target.value);
            savePrefs({darkMode, defaultDeck, defaultStyle:e.target.value});
          }}>
            <option value="whisper">Whisper (3–5 lines)</option>
            <option value="dialogue">Dialogue (2–3 paragraphs)</option>
            <option value="immersion">Immersion (full narrative)</option>
          </select>
        </div>
      </div>

      {/* Reading Context */}
      <div className="settings-section">
        <div className="settings-section-title">Reading Context</div>
        <p style={{fontFamily:"var(--font-body)",fontSize:"13px",lineHeight:"1.75",color:"var(--ash)",marginBottom:"20px"}}>
          This profile is passed into every reading. The more specific and current it is, the more grounded your readings feel.
        </p>
        <div className="context-card">
          <div className="context-card-label">
            {contextSaved&&!contextEditing ? "✓ Active, informing all readings" : "Draft, review before activating"}
          </div>
          <textarea value={contextProfile} onChange={e=>setContextProfile(e.target.value)} disabled={!contextEditing} style={{opacity:contextEditing?1:0.65}}/>
          <div className="context-actions">
            {contextEditing ? (
              <>
                <button className="context-btn primary" onClick={async()=>{try{await storage.set("oracle_context",contextProfile);setContextSaved(true);setContextEditing(false);}catch{}}}>Activate →</button>
                <button className="context-btn" onClick={()=>setContextProfile(CONTEXT_DRAFT)}>Reset</button>
              </>
            ) : (
              <button className="context-btn primary" onClick={()=>setContextEditing(true)}>Edit Profile</button>
            )}
          </div>
        </div>
      </div>

      {/* Log past pull */}
      <div className="settings-section">
        <div className="settings-section-title">Log a past pull</div>
        <div className="intake-row">
          <div>
            <label className="form-label">Date</label>
            <input type="date" className="intake-date" value={intakeDate} max={today} onChange={e=>setIntakeDate(e.target.value)}/>
          </div>
          <div>
            <label className="form-label">Deck</label>
            <div className="deck-chips" style={{marginTop:"8px"}}>
              {[["playing","Playing"],["tarot","Tarot"],["oracle","Oracle"]].map(([v,l])=>(
                <button key={v} className={`deck-chip ${intakeDeck===v?"selected":""}`} onClick={()=>setIntakeDeck(v)}>{l}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{marginBottom:"16px"}}>
          <label className="form-label">Card</label>
          <input className="form-input" placeholder={intakeDeck==="playing" ? "e.g. 7♣, K♠, Joker & Q♦" : "e.g. The Tower, 5 of Cups"} value={intakeCard} onChange={e=>setIntakeCard(e.target.value)}/>
        </div>
        <div style={{marginBottom:"16px"}}>
          <label className="form-label">Note <span style={{opacity:0.4}}>(optional)</span></label>
          <textarea className="form-textarea" placeholder="What was present that day? Any context worth preserving." value={intakeNote} onChange={e=>setIntakeNote(e.target.value)} rows={2}/>
        </div>
        <button className={`intake-save ${intakeSaved?"saved":""}`} disabled={!intakeDate||!intakeCard.trim()} onClick={saveIntake}>
          {intakeSaved ? "Saved to the Observatory" : "Add to the Observatory →"}
        </button>
      </div>

      {/* Logout */}
      <div className="settings-section" style={{borderTop:"1px solid var(--rule)",paddingTop:"28px",marginTop:"12px"}}>
        <button className="settings-logout-btn" onClick={async()=>{
          try { await storage.delete("oracle_user"); } catch {}
          await supabaseSignOut().catch(()=>{});
          setSupabaseUser(null);
          setOnboardStep("splash");
          setTimeout(()=>setOnboardStep("welcome"), 2200);
          setActiveTab("home");
        }}>
          ♦ sign out ♦
        </button>
      </div>
    </div>
  );

  const renderProfile = () => {
    const userName = onboardUser?.name || onboardName || "";
    const userInitial = userName ? userName[0].toUpperCase() : "♥";
    // Most pulled card this week
    const weekCards = Object.values(pulls)
      .filter(p => { const d=new Date(p.date+"T12:00:00"); const now=new Date(); return (now-d)/(1000*60*60*24) <= 7; })
      .map(p => p.card);
    const cardOfChoice = weekCards.length > 0 ? weekCards[weekCards.length-1] : null;

    return (
    <div className="origin-page fi">
      <PageHeader title="the origin" sub="who you are. where you've been." onSettings={()=>setActiveTab("settings")}/>

      {/* Avatar + name + bio */}
      <div className="origin-avatar-wrap">
        <label style={{cursor:"pointer"}}>
          <div className="origin-avatar">
            {profilePhoto
              ? <img src={profilePhoto} alt="profile"/>
              : <span className="origin-avatar-placeholder">{userInitial}</span>
            }
            <span className="origin-avatar-edit-hint">edit</span>
          </div>
          <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
            const f=e.target.files[0]; if(!f) return;
            const r=new FileReader(); r.onload=ev=>setProfilePhoto(ev.target.result); r.readAsDataURL(f);
          }}/>
        </label>

        {profileEditing ? (
          <>
            <div className="origin-edit-row" style={{width:"100%",padding:"0"}}>
              <input className="origin-edit-input" placeholder="your name"
                defaultValue={userName}
                onBlur={e=>{ setOnboardUser(u=>({...u,name:e.target.value})); setOnboardName(e.target.value); }}/>
            </div>
            <textarea className="origin-edit-input" placeholder="a short bio — your practice, your path, your vibe."
              rows={3} style={{width:"100%",resize:"none",textAlign:"left",fontSize:"14px"}}
              value={profileBio} onChange={e=>setProfileBio(e.target.value)}/>
            <button className="origin-edit-btn" onClick={()=>setProfileEditing(false)}>save</button>
          </>
        ) : (
          <>
            <div className="origin-name">{userName || "your name"}</div>
            {profileBio
              ? <div className="origin-bio">{profileBio}</div>
              : <div className="origin-bio" style={{opacity:0.35,fontStyle:"italic"}}>add a bio</div>
            }
            <button style={{background:"none",border:"none",cursor:"pointer",
              fontFamily:"'Montserrat',sans-serif",fontSize:"7px",letterSpacing:"0.18em",
              textTransform:"uppercase",color:"var(--silver)",marginTop:"-4px"}}
              onClick={()=>setProfileEditing(true)}>
              edit profile
            </button>
          </>
        )}
      </div>

      {/* Card of choice — most recent this week */}
      {cardOfChoice && (
        <div className="origin-card-of-choice">
          <div className="card-skew" style={{transform:`rotate(${cardRotation(today,4)}deg)`,flexShrink:0}}>
            <SmartCard cardStr={cardOfChoice} size={52}/>
          </div>
          <div>
            <div className="origin-card-label">this week's card</div>
            <CardTitle cardStr={cardOfChoice} style={{fontSize:"22px",fontWeight:300}}/>
          </div>
        </div>
      )}

      {/* Week in review */}
      <div style={{padding:"0 24px",marginBottom:"28px"}}>
        <div className="origin-section-title">week in review</div>
        <WeekBar pulls={pulls} today={today} onPullTap={()=>setActiveTab("pull")} onNavigateToObservatory={()=>setActiveTab("archive")}/>
      </div>

      {/* Friends list */}
      <div className="origin-friends-section">
        <div className="origin-section-title">friends</div>
        {profileFriends.length === 0 ? (
          <div className="origin-friends-empty">
            ♦ &nbsp; invite friends coming soon
          </div>
        ) : (
          profileFriends.map((f,i) => (
            <div key={i} style={{display:"flex",alignItems:"center",gap:"12px",padding:"12px 0",borderBottom:"1px solid var(--rule)"}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:"var(--paper-dark)",border:"1px solid var(--rule)",
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px",color:"var(--ash)"}}>
                {f.name[0]}
              </div>
              <div style={{fontFamily:"var(--font-display)",fontSize:"16px",fontWeight:300,textTransform:"lowercase"}}>{f.name}</div>
            </div>
          ))
        )}
      </div>
    </div>
    );
  };

  // ── Bottom Nav Icons ────────────────────────────────────────────────────
  const NavIcon = ({ tab, active = false }) => {
    const suitMap = { home: "spade", archive: "diamond", profile: "heart" };
    const suit = suitMap[tab];
    if (!suit) return null;
    const isRed = tab === "profile" && active;
    return (
      <SuitIcon
        suit={suit}
        size={16}
        style={{ color: isRed ? "var(--red-suit)" : "currentColor" }}
      />
    );
  };

  const PullIcon = () => (
    <svg viewBox="0 0 154 150" width="30" height="29" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M72.5782 150C58.3472 150 45.6409 146.646 34.4594 139.939C23.4812 133.232 14.9426 124.289 8.84356 113.11C2.94785 101.728 0 89.4309 0 76.2195C0 60.3659 4.16766 46.6463 12.503 35.061C20.8383 23.4756 31.3083 14.7358 43.9129 8.84146C56.7208 2.94715 69.732 0 82.9465 0C97.1776 0 109.681 3.45529 120.455 10.3659C131.23 17.2764 139.464 26.3211 145.156 37.5C151.052 48.6789 154 60.3659 154 72.561C154 86.3821 150.341 99.2886 143.022 111.28C135.703 123.069 125.741 132.52 113.137 139.634C100.735 146.545 87.2158 150 72.5782 150ZM80.8119 143.902C97.6858 143.902 111.104 138.313 121.065 127.134C131.23 115.955 136.313 100.407 136.313 80.4878C136.313 66.8699 133.873 54.4715 128.994 43.2927C124.115 31.9106 116.898 22.8659 107.343 16.1585C97.7875 9.45122 86.301 6.09756 72.8832 6.09756C55.3993 6.09756 41.7782 11.687 32.0198 22.8659C22.4647 34.0447 17.6871 49.3902 17.6871 68.9024C17.6871 82.7236 20.1267 95.3252 25.0059 106.707C30.0884 118.089 37.4073 127.134 46.9624 133.841C56.5175 140.549 67.8007 143.902 80.8119 143.902Z" fill="currentColor"/>
      <path d="M98.9832 73.9782C78.9362 73.1078 77.9695 46.4772 77.9837 40.9849C77.9851 40.4394 77.5454 40 77 40C76.4556 40 76.0175 40.4404 76.0221 40.9848C76.0679 46.4777 75.245 73.1153 55.0171 73.9785C54.4653 74.0021 54 74.4477 54 75C54 75.5523 54.4653 75.9979 55.0171 76.0215C75.245 76.8847 76.0679 103.522 76.0221 109.015C76.0175 109.56 76.4556 110 77 110C77.5454 110 77.9851 109.561 77.9837 109.015C77.9695 103.523 78.9362 76.8922 98.9832 76.0218C99.535 75.9979 100 75.5523 100 75C100 74.4477 99.535 74.0021 98.9832 73.9782Z" fill="currentColor"/>
    </svg>
  );

  const OracleStarIcon = ({ size = 22, style = {} }) => (
    <svg
      width={size}
      height={size * (67/45)}
      viewBox="0 0 45 67"
      fill="none"
      className="bnav-icon"
      style={{overflow:"visible", ...style}}
    >
      <path
        d="M43.1843 32.1681C24.3567 31.1661 23.3526 6.86155 23.3758 1.18003C23.3784 0.529177 22.8546 0 22.2037 0C21.5501 0 21.025 0.534044 21.0313 1.18766C21.0867 6.88429 20.2059 31.1753 1.21604 32.1686C0.554209 32.2033 0 32.7373 0 33.4C0 34.0627 0.554072 34.5967 1.21591 34.6313C20.1092 35.6191 21.2322 59.6528 21.2242 65.518C21.2232 66.2209 21.789 66.8 22.4919 66.8C23.2009 66.8 23.7691 66.2097 23.7593 65.5009C23.6778 59.6074 24.4981 35.6276 43.1841 34.6319C43.8459 34.5967 44.4 34.0627 44.4 33.4C44.4 32.7373 43.8461 32.2033 43.1843 32.1681Z"
        fill="currentColor"
      />
    </svg>
  );

  // ── Root render ─────────────────────────────────────────────────────────
  // Inject Google Fonts into <head> on mount (can't use @import in injected <style>)
  useEffect(() => {
    if (document.getElementById("oracle-fonts")) return;
    const preconnect1 = document.createElement("link");
    preconnect1.rel = "preconnect";
    preconnect1.href = "https://fonts.googleapis.com";
    const preconnect2 = document.createElement("link");
    preconnect2.rel = "preconnect";
    preconnect2.href = "https://fonts.gstatic.com";
    preconnect2.crossOrigin = "anonymous";
    const link = document.createElement("link");
    link.id = "oracle-fonts";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Cormorant+Unicase:wght@300;400;500;600&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Montserrat:wght@300;400;500;600&display=swap";
    document.head.appendChild(preconnect1);
    document.head.appendChild(preconnect2);
    document.head.appendChild(link);
  }, []);

  // Onboarding handlers
  const handleOnboardComplete = (nextStep) => setOnboardStep(nextStep);
  const handleOnboardUpdate = (updates) => {
    if (updates.name) setOnboardName(updates.name);
    if (updates.deck) { setOnboardDeck(updates.deck); setDefaultDeck(updates.deck); setPullDeck(updates.deck); }
    if (updates.email) setOnboardUser(u => ({...u, email: updates.email}));
  };

  // Desktop detection
  const [isDesktop, setIsDesktop] = React.useState(() => window.innerWidth >= 1024);
  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const DESKTOP_CSS = `
    @media (min-width: 1024px) {
      .bottom-nav { display: none !important; }
      .desktop-sidebar {
        position: fixed; top: 0; left: 0; bottom: 0; width: max(25vw, calc((100vw - 720px) / 2));
        border-right: 1px solid var(--rule);
        background: var(--paper);
        display: flex; flex-direction: column;
        padding: 40px 0 32px;
        z-index: 50;
        transition: background 0.3s;
      }
      .desktop-sidebar-logo {
        padding: 0 28px 32px;
        font-family: 'Cormorant Unicase', Georgia, serif;
        font-size: 22px; font-weight: 300; letter-spacing: 0.04em;
        text-transform: lowercase; color: var(--ink);
        border-bottom: 1px solid var(--rule);
        margin-bottom: 20px;
        display: flex; align-items: center; gap: 10px;
      }
      .desktop-nav-item {
        display: flex; align-items: center; gap: 14px;
        padding: 13px 28px;
        font-family: 'Montserrat', sans-serif; font-size: 8px;
        letter-spacing: 0.22em; text-transform: uppercase;
        color: var(--silver); cursor: pointer;
        border: none; background: none; width: 100%; text-align: left;
        transition: color 0.15s, background 0.15s;
        position: relative;
      }
      .desktop-nav-item:hover { color: var(--ink); background: var(--paper-dark); }
      .desktop-nav-item.active { color: var(--ink); }
      .desktop-nav-item.active::before {
        content: ''; position: absolute; left: 0; top: 20%; bottom: 20%;
        width: 2px; background: var(--ink);
      }
      .desktop-nav-pull {
        margin: 16px 28px 0;
        padding: 14px 20px;
        background: var(--red-suit); color: #fff;
        border: none; border-radius: 4px;
        font-family: 'Montserrat', sans-serif; font-size: 8px;
        letter-spacing: 0.22em; text-transform: uppercase;
        cursor: pointer; transition: opacity 0.15s;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        box-shadow: 0 2px 12px rgba(139,18,18,0.28);
      }
      .desktop-nav-pull:hover { opacity: 0.85; }
      .desktop-nav-pull.has-pull {
        background: transparent; color: var(--ink);
        border: 1px solid var(--rule); box-shadow: none;
      }
      .desktop-nav-pull.has-pull:hover { background: var(--paper-dark); }
      .desktop-nav-spacer { flex: 1; }
      .desktop-nav-settings {
        padding: 13px 28px;
        font-family: 'Montserrat', sans-serif; font-size: 7px;
        letter-spacing: 0.22em; text-transform: uppercase;
        color: var(--silver); cursor: pointer;
        border: none; background: none; width: 100%; text-align: left;
        transition: color 0.15s; display: flex; align-items: center; gap: 12px;
      }
      .desktop-nav-settings:hover { color: var(--ink); }
      .desktop-center {
        margin-left: max(25vw, calc((100vw - 720px) / 2));
        margin-right: max(25vw, calc((100vw - 720px) / 2));
        min-height: 100vh;
        background: var(--paper);
        transition: background 0.3s;
      }
      /* Center column content — fill full 50vw width, keep 24px gutters from global */
      .desktop-center .app { max-width: 100%; margin: 0; padding-bottom: 60px; }
      /* Pages that add their own 24px side padding — remove it (app gutters are enough) */
      .desktop-center .settings-page,
      .desktop-center .origin-page { padding-left: 0; padding-right: 0; }
      /* Offering/home — stretch children to fill column width, center card within it */
      .desktop-center .offering-screen { align-items: stretch; }
      .desktop-center .offering-card-wrap { display: flex; justify-content: center; }
      .desktop-oracle-panel {
        position: fixed; top: 0; right: 0; bottom: 0; width: max(25vw, calc((100vw - 720px) / 2));
        border-left: 1px solid var(--rule);
        background: var(--paper);
        display: flex; flex-direction: column;
        z-index: 50; transition: background 0.3s;
        overflow: hidden;
      }
      .desktop-oracle-header {
        padding: 28px 24px 20px;
        border-bottom: 1px solid var(--rule);
        display: flex; align-items: center; justify-content: space-between;
        flex-shrink: 0;
      }
      .desktop-oracle-title {
        font-family: 'Cormorant Unicase', Georgia, serif;
        font-size: 22px; font-weight: 300; letter-spacing: 0.03em;
        text-transform: lowercase; color: var(--ink);
        display: flex; align-items: center; gap: 8px;
      }
      .desktop-oracle-body { flex: 1; overflow-y: auto; }
      .desktop-oracle-nopull {
        display: flex; flex-direction: column; align-items: center;
        justify-content: center; height: 100%;
        padding: 40px 32px; text-align: center; gap: 16px;
      }
      .desktop-oracle-nopull-label {
        font-family: 'Montserrat', sans-serif; font-size: 8px;
        letter-spacing: 0.22em; text-transform: uppercase; color: var(--silver);
      }
      .desktop-oracle-nopull-text {
        font-family: 'Cormorant Garamond', Georgia, serif;
        font-style: italic; font-size: 15px; color: var(--ash); line-height: 1.7;
      }
      /* ── Full-width pages: snap fixed overlays to center column ── */
      .oracle-page { left: max(25vw, calc((100vw - 720px) / 2)); right: max(25vw, calc((100vw - 720px) / 2)); max-width: none; margin: 0; }
      .oracle-input-row { left: max(25vw, calc((100vw - 720px) / 2)); right: max(25vw, calc((100vw - 720px) / 2)); max-width: none; margin: 0; bottom: 0; }
      .reading-input-row { left: max(25vw, calc((100vw - 720px) / 2)); right: max(25vw, calc((100vw - 720px) / 2)); }
      .reading-save-btn { left: max(25vw, calc((100vw - 720px) / 2)); right: max(25vw, calc((100vw - 720px) / 2)); }
      .offering-sticky-cta { left: max(25vw, calc((100vw - 720px) / 2)); right: max(25vw, calc((100vw - 720px) / 2)); max-width: none; margin: 0; bottom: 0; }
      .pull-form { max-width: 100%; }
    }
    @media (max-width: 1023px) {
      .desktop-sidebar { display: none !important; }
      .desktop-oracle-panel { display: none !important; }
      .desktop-center { margin: 0 !important; }
    }
  `;

  return (
    <DarkContext.Provider value={darkMode}>
    <>
      <style>{GLOBAL_CSS}</style>
      <style>{DESKTOP_CSS}</style>
      {/* Onboarding overlay — shown until onboardStep === "app" */}
      {onboardStep !== "app" && (
        <Onboarding
          step={onboardStep}
          onComplete={handleOnboardComplete}
          onUpdate={handleOnboardUpdate}
          user={onboardUser}
        />
      )}
      {paywallVisible && (
        <PaywallModal info={paywallInfo} onClose={()=>setPaywallVisible(false)}/>
      )}
      <div className="grain-overlay" aria-hidden="true"/>
      <div className={darkMode ? "dark" : ""} style={{minHeight:"100vh",background:"var(--paper)",transition:"background 0.3s"}}>

        {/* ── Desktop left sidebar nav ── */}
        {isDesktop && (
          <aside className="desktop-sidebar">
            <div className="desktop-sidebar-logo">
              <SuitIcon suit="spade" size={14} style={{opacity:0.4}}/>
              oracle
            </div>
            <button className={`desktop-nav-item ${activeTab==="home"?"active":""}`} onClick={()=>setActiveTab("home")}>
              <SuitIcon suit="spade" size={14}/>
              Offering
            </button>
            <button className={`desktop-nav-item ${activeTab==="veil"?"active":""}`} onClick={()=>setActiveTab("veil")}>
              <SuitIcon suit="diamond" size={14} style={{color: activeTab==="veil" ? "var(--red-suit)" : "currentColor"}}/>
              Oblivion
              <span style={{
                marginLeft:"auto", fontSize:"7px", letterSpacing:"0.14em",
                padding:"2px 5px", borderRadius:"2px",
                background:"rgba(201,64,64,0.18)", color:"#c94040",
                fontFamily:"'Montserrat',sans-serif", textTransform:"uppercase",
              }}>pro</span>
            </button>
            <button className={`desktop-nav-item ${activeTab==="archive"?"active":""}`} onClick={()=>setActiveTab("archive")}>
              <SuitIcon suit="club" size={14}/>
              Observatory
            </button>
            <button className={`desktop-nav-item ${activeTab==="profile"?"active":""}`} onClick={()=>setActiveTab("profile")}>
              <SuitIcon suit="heart" size={14} style={{color: activeTab==="profile" ? "var(--red-suit)" : "currentColor"}}/>
              Origin
            </button>
            <div style={{margin:"20px 28px 4px", borderTop:"1px solid var(--rule)"}}/>
            <button
              className={`desktop-nav-pull ${todayPull ? "has-pull" : ""}`}
              onClick={()=>{
                if (todayPull) {
                  setActiveTab("reading");
                } else {
                  setPullDeck(defaultDeck); setPullStyle(defaultStyle);
                  setPullMode("manual"); setRandomCard(null);
                  setShowReveal(false); setPullCard("");
                  setActiveTab("pull");
                }
              }}>
              {todayPull ? (
                <><SuitIcon suit="spade" size={10}/> today's reading</>
              ) : (
                <><SuitIcon suit="diamond" size={10} style={{color:"rgba(255,255,255,0.7)"}}/> pull a card <SuitIcon suit="diamond" size={10} style={{color:"rgba(255,255,255,0.7)"}}/></>
              )}
            </button>
            <div className="desktop-nav-spacer"/>
            <button className="desktop-nav-settings" onClick={()=>setActiveTab("settings")}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              Settings
            </button>
          </aside>
        )}

        {/* ── Desktop right Oracle panel ── */}
        {isDesktop && (
          <aside className="desktop-oracle-panel">
            <div className="desktop-oracle-header">
              <div className="desktop-oracle-title">
                <SuitIcon suit="diamond" size={13} style={{color:"var(--red-suit)"}}/>
                oracle
              </div>
              <div style={{fontFamily:"'Montserrat',sans-serif",fontSize:"7px",letterSpacing:"0.18em",textTransform:"uppercase",color:"var(--silver)"}}>
                always listening
              </div>
            </div>
            <div className="desktop-oracle-body">
              {todayPull ? renderOracle() : (
                <div className="desktop-oracle-nopull">
                  <div style={{opacity:0.2, marginBottom:"8px"}}>
                    <SuitIcon suit="diamond" size={32} style={{color:"var(--red-suit)"}}/>
                  </div>
                  <div className="desktop-oracle-nopull-label">no card yet today</div>
                  <div className="desktop-oracle-nopull-text">
                    Pull today's card to open your conversation with the oracle.
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}

        <div className={isDesktop ? "desktop-center" : ""}>
        <div className="app">

          {/* Persistent suit icons — shared element above all pages, never unmounts */}
          {activeTab !== "pull" && activeTab !== "oracle" && activeTab !== "reading" && activeTab !== "veil" && (
            <AppSuitsBar cycling={suitsState === "cycling"}/>
          )}

          {/* Header title for non-home pages (suits now in AppSuitsBar above) */}
          {activeTab !== "pull" && activeTab !== "home" && activeTab !== "oracle" && activeTab !== "reading" && activeTab !== "archive" && activeTab !== "veil" && (
            <div className="header" style={{flexDirection:"column", alignItems:"center", textAlign:"center", gap:"10px", position:"relative", paddingTop:"16px"}}>
              <button className="dots-menu-btn" onClick={()=>setActiveTab("profile")}
                style={{position:"absolute", top:0, right:0}}>
                <svg width="14" height="14" viewBox="0 0 4 16" fill="currentColor">
                  <circle cx="2" cy="2" r="1.2"/>
                  <circle cx="2" cy="8" r="1.2"/>
                  <circle cx="2" cy="14" r="1.2"/>
                </svg>
              </button>
              <div className="header-title">the offering</div>
            </div>
          )}

          {/* Home header — suits now in AppSuitsBar above */}
          {activeTab === "home" && (
            <div className="offering-page-header" style={{paddingTop:"8px"}}>
              <div className="header-title">the offering</div>
              <div className="offering-page-subhead">
                {todayPull ? "your draw of the day" : "your daily draw awaits"}
              </div>
            </div>
          )}

          {/* Page content */}
          <div className="fi" key={activeTab}>
            {activeTab === "pull" && renderPullForm()}
            {activeTab === "profile" && renderProfile()}
            {activeTab === "settings" && renderSettings()}
            {activeTab === "oracle" && renderOracle()}
            {activeTab === "veil" && renderVeil()}
            {activeTab === "reading" && renderReading()}
            {activeTab === "archive" && (
              <>
                <PageHeader title="the observatory" sub="every card you've ever pulled." onSettings={()=>setActiveTab("settings")}/>

                {/* Full-width tab bar */}
                <div className="vault-tabs">
                  <button
                    className={`vault-tab ${calView==="calendar"?"active":""}`}
                    onClick={()=>setCalView("calendar")}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    Calendar
                  </button>
                  <button
                    className={`vault-tab ${calView==="timeline"?"active":""}`}
                    onClick={()=>setCalView("timeline")}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none"/>
                    </svg>
                    Timeline
                  </button>
                </div>

                {calView==="calendar" ? renderCalendar() : renderTimeline()}
              </>
            )}
            {activeTab === "home" && (
              <div style={{paddingBottom:"16px"}}>
                {!todayPull ? (
                  <>
                  <div className="offering-screen">

                    {/* Date stage — ghost numerals + editorial lockup */}
                    {(() => {
                      const d = new Date(today+"T12:00:00");
                      const dayNum = d.getDate();
                      const padded = String(dayNum).padStart(2, "0");
                      const monthName = ["January","February","March","April","May","June",
                        "July","August","September","October","November","December"][d.getMonth()];
                      const dayName = ["Sunday","Monday","Tuesday","Wednesday",
                        "Thursday","Friday","Saturday"][d.getDay()];
                      return (
                        <div className="offering-date-stage">
                          <div className="offering-date-bg" style={{fontSize:"clamp(240px,68vw,340px)"}}>
                            <span>{padded[0]}</span>
                            <span>{padded[1]}</span>
                          </div>
                          <div className="offering-date-editorial">
                            <div className="offering-date-top">
                              <span className="offering-date-num">{dayNum}</span>
                              <span className="offering-date-slash">/</span>
                              <span className="offering-date-month">{monthName}</span>
                            </div>
                            <span className="offering-date-day">{dayName}</span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* O card back — tapping expands the selector */}
                    <div className="offering-card-wrap"
                      onClick={()=>setOfferingExpanded(true)}>
                      {(() => {
                        // If a card has been oracle-selected, show the face card
                        if (pullCard && !pullCard.startsWith("?") && offeringExpanded) {
                          const parsed = parseCard(pullCard);
                          if (parsed) {
                            return (
                              <div style={{animation:"cardFlipIn 0.7s cubic-bezier(0.34,1.56,0.64,1) forwards"}}>
                                <SmartCard cardStr={pullCard} size={Math.min(260, Math.round(window.innerWidth * 0.58))}/>
                              </div>
                            );
                          }
                        }
                        return <CardBack size={Math.min(260, Math.round(window.innerWidth * 0.58))} dark={darkMode}/>;
                      })()}
                    </div>

                    {/* Intention — visible input box */}
                    <div className="offering-intention">
                      <label className="offering-intention-label">Intention</label>
                      <textarea
                        className="offering-intention-input"
                        placeholder="State your intention. Say a prayer."
                        value={offeringIntention}
                        onChange={e=>setOfferingIntention(e.target.value)}
                        rows={3}
                      />
                      <button
                        className={`offering-mic-btn ${isRecording ? "recording" : ""}`}
                        title={isRecording ? "Stop recording" : "Speak your intention"}
                        onClick={()=>{
                          const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
                          if (!SR) { alert("Speech recognition not supported in this browser."); return; }
                          if (isRecording) {
                            recognitionRef.current && recognitionRef.current.stop();
                            setIsRecording(false);
                            return;
                          }
                          const recognition = new SR();
                          recognition.continuous = true;
                          recognition.interimResults = true;
                          recognition.lang = "en-US";
                          let finalTranscript = offeringIntention;
                          recognition.onresult = (e) => {
                            let interim = "";
                            for (let i = e.resultIndex; i < e.results.length; i++) {
                              if (e.results[i].isFinal) {
                                finalTranscript += (finalTranscript ? " " : "") + e.results[i][0].transcript;
                              } else {
                                interim += e.results[i][0].transcript;
                              }
                            }
                            setOfferingIntention(finalTranscript + (interim ? " " + interim : ""));
                          };
                          recognition.onend = () => {
                            setIsRecording(false);
                            setOfferingIntention(finalTranscript);
                          };
                          recognition.onerror = () => setIsRecording(false);
                          recognitionRef.current = recognition;
                          recognition.start();
                          setIsRecording(true);
                        }}>
                        {isRecording ? (
                          <svg width="12" height="12" viewBox="0 0 14 14" fill="white">
                            <rect x="2" y="2" width="10" height="10" rx="2"/>
                          </svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                            stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="2" width="6" height="12" rx="3"/>
                            <path d="M5 10a7 7 0 0 0 14 0"/>
                            <line x1="12" y1="19" x2="12" y2="23"/>
                            <line x1="8" y1="23" x2="16" y2="23"/>
                          </svg>
                        )}
                      </button>
                    </div>

                    {/* Expansion panel — fades in when offeringExpanded */}
                    {offeringExpanded && (() => {
                      const SUIT_SYM = { spades:"♠", hearts:"♥", diamonds:"♦", clubs:"♣" };
                      const suits = [
                        { key:"spades",   sym:"spade",   red:false },
                        { key:"diamonds", sym:"diamond", red:true  },
                        { key:"clubs",    sym:"club",    red:false },
                        { key:"hearts",   sym:"heart",   red:true  },
                      ];
                      const allRanks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
                      const selSuit = pullCard && !pullCard.startsWith("?")
                        ? parseCard(pullCard)?.suit
                        : pullCard?.length > 1
                          ? Object.keys(SUIT_SYM).find(k => pullCard.endsWith(SUIT_SYM[k]))
                          : null;
                      const selRank = pullCard && !pullCard.startsWith("?")
                        ? parseCard(pullCard)?.rank
                        : null;
                      const hasCard = selSuit && selRank;

                      const selectSuit = (key) => {
                        const sym = SUIT_SYM[key];
                        if (selRank) setPullCard(selRank + sym);
                        else setPullCard("?" + sym);
                      };
                      const selectRank = (rank) => {
                        const sym = selSuit ? SUIT_SYM[selSuit] : "?";
                        setPullCard(rank + sym);
                      };

                      return (
                        <div className="offering-expand">
                          {/* Oracle choose — red CTA */}
                          <button className="offering-cta" onClick={()=>{
                            setPullIntention(offeringIntention);
                            startDrawAnimation();
                          }}>
                            <SuitIcon suit="spade"   size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
                            <SuitIcon suit="diamond" size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
                            let the oracle choose
                            <SuitIcon suit="club"    size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
                            <SuitIcon suit="heart"   size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
                          </button>

                          {/* Divider */}
                          <div className="offering-expand-divider">
                            <div className="offering-expand-rule"/>
                            <span className="offering-expand-or">or</span>
                            <div className="offering-expand-rule"/>
                          </div>

                          {/* Eyebrow */}
                          <span className="offering-expand-eyebrow">drawn by your own hand</span>

                          {/* Suit grid */}
                          <div className="offering-suit-grid">
                            {suits.map(({ key, sym, red }) => {
                              const isSel = selSuit === key;
                              return (
                                <button key={key}
                                  className={`offering-suit-btn ${isSel ? (red ? "sel-red" : "sel-black") : ""}`}
                                  onClick={() => selectSuit(key)}>
                                  <SuitIcon suit={sym} size={26}
                                    style={{color: isSel ? "#fff" : red ? "var(--red-suit)" : "var(--ink)"}}/>
                                </button>
                              );
                            })}
                          </div>

                          {/* Rank grid */}
                          <div className="offering-rank-grid">
                            {allRanks.map(r => (
                              <button key={r}
                                className={`offering-rank-btn ${selRank===r?"sel":""}`}
                                onClick={() => selectRank(r)}>{r}</button>
                            ))}
                          </div>

                          {/* Bottom CTA — changes when card selected */}
                          {hasCard ? (
                            <button className="offering-oracle-cta"
                              onClick={()=>{
                                setPullIntention(offeringIntention);
                                setPullStyle(defaultStyle);
                                setPullDeck(defaultDeck);
                                setOfferingExpanded(false);
                                setActiveTab("pull");
                                // generateReading is called in pull form on mount when pullCard is set
                                // trigger it via a small delay so the tab switch renders first
                                setTimeout(() => generateReading(), 80);
                              }}>
                              <SuitIcon suit="diamond" size={10} style={{color:"rgba(255,255,255,0.6)"}}/>
                              hear what the cards say
                              <SuitIcon suit="diamond" size={10} style={{color:"rgba(255,255,255,0.6)"}}/>
                            </button>
                          ) : (
                            <button className="offering-cta" style={{opacity:0.4,cursor:"default",animation:"none"}} disabled>
                              <SuitIcon suit="spade"   size={10} style={{color:"rgba(255,255,255,0.5)"}}/>
                              <SuitIcon suit="diamond" size={10} style={{color:"rgba(255,255,255,0.5)"}}/>
                              choose your card above
                              <SuitIcon suit="club"    size={10} style={{color:"rgba(255,255,255,0.5)"}}/>
                              <SuitIcon suit="heart"   size={10} style={{color:"rgba(255,255,255,0.5)"}}/>
                            </button>
                          )}
                        </div>
                      );
                    })()}

                    {/* Week at a glance */}
                    <WeekBar
                      pulls={pulls}
                      today={today}
                      contextProfile={contextProfile}
                      onDayTap={(pull) => { setReflectionDraft(pull.reflection||""); setSelectedEntry(pull); }}
                      onPullTap={() => setOfferingExpanded(true)}
                      onNavigateToObservatory={() => setActiveTab("archive")}
                    />

                  </div>

                  {/* Sticky CTA — opens expansion panel */}
                  {!offeringExpanded && (
                    <div className="offering-sticky-cta">
                      <button className="offering-cta" onClick={()=>{
                        setPullIntention(offeringIntention);
                        setOfferingExpanded(true);
                      }}>
                        <SuitIcon suit="spade"   size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
                        <SuitIcon suit="diamond" size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
                        pull your card
                        <SuitIcon suit="club"    size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
                        <SuitIcon suit="heart"   size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
                      </button>
                    </div>
                  )}
                  </>
                ) : (
                  /* ── Post-pull: same offering layout, card revealed, reading below ── */
                  (() => {
                    const d = new Date(todayPull.date+"T12:00:00");
                    const dayNum = d.getDate();
                    const padded = String(dayNum).padStart(2,"0");
                    const monthName = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"][d.getMonth()];
                    const dayName = ["Sunday","Monday","Tuesday","Wednesday",
                      "Thursday","Friday","Saturday"][d.getDay()];
                    return (
                      <div className="offering-screen">

                        {/* Date stage */}
                        <div className="offering-date-stage">
                          <div className="offering-date-bg" style={{fontSize:"clamp(240px,68vw,340px)"}}>
                            <span>{padded[0]}</span><span>{padded[1]}</span>
                          </div>
                          <div className="offering-date-editorial">
                            <div className="offering-date-top">
                              <span className="offering-date-num">{dayNum}</span>
                              <span className="offering-date-slash">/</span>
                              <span className="offering-date-month">{monthName}</span>
                            </div>
                            <span className="offering-date-day">{dayName}</span>
                          </div>
                        </div>

                        {/* Revealed card — floats with same animation */}
                        <div className="offering-card-wrap"
                          onClick={()=>setActiveTab("reading")}
                          style={{cursor:"pointer"}}>
                          <SmartCard
                            cardStr={todayPull.card}
                            size={Math.min(260, Math.round(window.innerWidth * 0.58))}
                          />
                        </div>

                        {/* Intention — shown if present */}
                        {todayPull.intention && (
                          <div className="offering-intention" style={{marginBottom:"20px"}}>
                            <label className="offering-intention-label">Intention</label>
                            <div style={{
                              fontFamily:"var(--font-body)", fontSize:"16px",
                              fontStyle:"italic", fontWeight:300, color:"var(--ash)",
                              lineHeight:1.8, padding:"14px 18px",
                              border:"1px solid var(--rule)", borderRadius:"var(--card-radius)",
                              background:"var(--paper-dark)", boxShadow:"var(--inner-inset)",
                            }}>
                              "{todayPull.intention}"
                            </div>
                          </div>
                        )}

                        {/* Reading box */}
                        {todayPull.reading && (
                          <div className="offering-intention" style={{marginBottom:"0"}}>
                            <label className="offering-intention-label">the oracle's reading</label>
                            <div style={{
                              fontFamily:"var(--font-body)", fontSize:"17px",
                              fontWeight:300, color:"var(--ink)",
                              lineHeight:1.85, padding:"18px 20px",
                              border:"1px solid var(--rule)", borderRadius:"var(--card-radius)",
                              background:"var(--paper-dark)", boxShadow:"var(--inner-inset)",
                            }}>
                              {todayPull.reading.split("\n\n").map((p,i)=>(
                                <p key={i} style={{marginBottom: i < todayPull.reading.split("\n\n").length-1 ? "14px" : 0}}>{p}</p>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* WeekBar */}
                        <WeekBar
                          pulls={pulls}
                          today={today}
                          contextProfile={contextProfile}
                          onDayTap={(pull) => { setReflectionDraft(pull.reflection||""); setSelectedEntry(pull); }}
                          onPullTap={() => setActiveTab("pull")}
                          onNavigateToObservatory={() => setActiveTab("archive")}
                        />

                      </div>
                    );
                  })()
                )}

                {/* Sticky CTA — changes based on pull state */}
                {todayPull && (
                  <div className="offering-sticky-cta">
                    <button className="offering-cta" onClick={()=>setActiveTab("reading")}>
                      <SuitIcon suit="spade"   size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
                      <SuitIcon suit="diamond" size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
                      consult the oracle
                      <SuitIcon suit="club"    size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
                      <SuitIcon suit="heart"   size={10} style={{color:"rgba(255,255,255,0.7)"}}/>
                    </button>
                  </div>
                )}

                {/* Recent pulls feed */}
                <div style={{marginTop: todayPull ? "40px" : "24px"}}>
                  {/* Week at a glance — post pull */}
                  {todayPull && (
                    <WeekBar
                      pulls={pulls}
                      today={today}
                      contextProfile={contextProfile}
                      onDayTap={(pull) => { setReflectionDraft(pull.reflection||""); setSelectedEntry(pull); }}
                      onPullTap={() => setActiveTab("pull")}
                      onNavigateToObservatory={() => setActiveTab("archive")}
                    />
                  )}
                  <div style={{marginTop: todayPull ? "28px" : "0"}}>
                    <ModuleHeader label="Recent Observations" ctaLabel="Dive Deeper" onCta={()=>setActiveTab("archive")}/>
                  </div>
                  {Object.values(pulls)
                    .sort((a,b)=>b.date.localeCompare(a.date))
                    .slice(todayPull ? 1 : 0, 5)
                    .map((pull,idx)=>(
                      <div key={pull.date} className="timeline-entry"
                        onClick={e=>openEntry(e,pull,48)}>
                        {/* Card — left, hand-placed rotation */}
                        <div style={{display:"flex",justifyContent:"center"}}>
                          <div className="card-skew" style={{transform:`rotate(${cardRotation(pull.date,12) * (idx % 2 === 0 ? 1 : -1)}deg)`}}>
                            <SmartCard cardStr={pull.card} size={48}/>
                          </div>
                        </div>
                        {/* Right — title + meta (date · time) + preview */}
                        <div style={{minWidth:0}}>
                          <div style={{display:"flex",alignItems:"baseline",gap:"10px",flexWrap:"wrap"}}>
                            <CardTitle cardStr={pull.card} className="timeline-card-name" style={{fontSize:"26px"}}/>
                            <div className="timeline-meta">{formatDateShort(pull.date)}{pull.time ? ` · ${pull.time}` : ""}</div>
                          </div>
                          <div className="timeline-preview">{pull.reading}</div>
                        </div>
                        <div className="timeline-arrow">→</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}
          </div>

          {renderModal()}
          {renderGhostCard()}
        </div>

        {/* ── Draw animation overlay ── */}
        {(drawAnim === "fading" || drawAnim === "animating" || drawAnim === "revealing" || drawAnim === "fadeout") && (() => {
          // Inline ribbon loop animation
          const CW = 88, CH = Math.round(88*1.4);
          const SUITS3=["spades","hearts","diamonds","clubs"];
          const RANKS3=["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
          // SP3 no longer needed — MiniCard handles all card rendering
          const SP3_UNUSED = {
            spades:{p:["M34 70L24 70H23L22 69.9999C22 69.9999 22.9433 70 12.0027 70C11.4505 69.9999 11 69.5522 11 69C11 68.4477 11.4531 68.0069 12.0016 67.9425C21.8639 66.785 22.1185 48.4873 22.0313 43.9917C22.0208 43.4483 22.4565 43 23 43C23.5442 43 23.9812 43.4477 23.9728 43.9918C23.9037 48.4864 24.2266 66.7748 33.9987 67.9415C34.5471 68.007 35 68.4477 35 69C35 69.5522 34.5523 69.9999 34 70Z","M39.5 48C32.5186 48 27.0415 45.2765 24.9358 44.0548C24.314 43.694 23.6146 43.4739 22.8958 43.4739C22.3079 43.4739 21.7341 43.6194 21.2082 43.8822C18.8527 45.0591 11.669 48.375 5.5 48.375C2.46243 48.375 0 45.9126 0 42.875V42C0 36.4772 4.80378 32.3519 9.60466 29.6218C20.9992 23.1421 21.9448 5.36783 22.002 0.986088C22.0092 0.436882 22.4539 7.62939e-06 23.0031 7.62939e-06C23.55 7.62939e-06 23.9936 0.433262 24.0039 0.980011C24.0865 5.37182 25.1361 23.3058 36.625 29.7121C41.3281 32.3345 46 36.3652 46 41.75C46 45.2018 43.2018 48 39.75 48H39.5Z"],c:[{cx:11.5,cy:43.5,r:11.5},{cx:34.5,cy:43.5,r:11.5}],vb:"0 0 46 70"},
            diamonds:{p:["M44.9832 33.9782C24.9362 33.1078 23.9695 6.47722 23.9837 0.984877C23.9851 0.439449 23.5454 0 23 0C22.4556 0 22.0175 0.440389 22.0221 0.984775C22.0679 6.47767 21.245 33.1153 1.01707 33.9785C0.465288 34.0021 0 34.4477 0 35C0 35.5523 0.46529 35.9979 1.01707 36.0215C21.245 36.8847 22.0679 63.5223 22.0221 69.0152C22.0175 69.5596 22.4556 70 23 70C23.5454 70 23.9851 69.5606 23.9837 69.0151C23.9695 63.5228 24.9362 36.8922 44.9832 36.0218C45.535 35.9979 46 35.5523 46 35C46 34.4477 45.535 34.0021 44.9832 33.9782Z"],c:[],vb:"0 0 46 70"},
            hearts:{p:["M39.5 24.875C32.6223 24.875 27.2045 26.0582 25.0319 26.6163C24.3419 26.7935 23.6377 26.9011 22.9254 26.9011C22.311 26.9011 21.7005 26.8207 21.1036 26.6756C18.6462 26.0781 11.5802 24.5 5.5 24.5H2.75C1.23122 24.5 0 25.7312 0 27.25V27.5C4.29691e-06 33.0229 4.81169 37.1515 9.58962 39.9215C21.0165 46.5464 21.9477 64.7713 22.0023 69.2146C22.009 69.7639 22.4538 70.2011 23.0031 70.2011C23.55 70.2011 23.9937 69.7673 24.0035 69.2205C24.0828 64.795 25.106 46.6116 36.4221 39.9556C41.1825 37.1556 46 33.0228 46 27.5C46 26.0503 44.8248 24.875 43.375 24.875H39.5Z"],c:[{cx:11.5,cy:26.5,r:11.5},{cx:34.5,cy:26.5,r:11.5}],vb:"0 0 46 71"},
            clubs:{p:["M23 10C18.03 10 14 14.03 14 19C14 22.1 15.6 24.83 18.03 26.45C14.06 27.8 11.22 31.56 11.22 36C11.22 41.63 15.81 46.22 21.44 46.22C22.63 46.22 23.77 46.01 24.83 45.63C24.28 47.04 24 48.56 24 50.11V52H22V54H24V56H26V54H28V52H26V50.11C26 48.56 25.72 47.04 25.17 45.63C26.23 46.01 27.37 46.22 28.56 46.22C34.19 46.22 38.78 41.63 38.78 36C38.78 31.56 35.94 27.8 31.97 26.45C34.4 24.83 36 22.1 36 19C36 14.03 31.97 10 27 10C25.6 10 24.28 10.35 23.12 10.96C23.07 10.65 23 10 23 10Z","M19 56L27 56L23 64Z"],c:[],vb:"0 0 46 70"},
          };
          // drawCardSVG replaced by MiniCard
          const drawCardSVG_UNUSED = (rank, suit, w, h, showBack) => {
            if (showBack) {
              const r=Math.max(2,Math.round(w*.07));
              const mw=w*.5,mx=(w-mw)/2,my=(h-mw*(150/154))/2;
              return (<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",position:"absolute",top:0,left:0}}>
                <rect width={w} height={h} rx={r} fill="#fdfaf5" stroke="rgba(10,10,10,0.1)" strokeWidth="0.8"/>
                <g transform={`translate(${mx},${my}) scale(${mw/154})`} fill="rgba(10,9,8,0.85)">
                  <path d="M72.5782 150C58.3472 150 45.6409 146.646 34.4594 139.939C23.4812 133.232 14.9426 124.289 8.84356 113.11C2.94785 101.728 0 89.4309 0 76.2195C0 60.3659 4.16766 46.6463 12.503 35.061C20.8383 23.4756 31.3083 14.7358 43.9129 8.84146C56.7208 2.94715 69.732 0 82.9465 0C97.1776 0 109.681 3.45529 120.455 10.3659C131.23 17.2764 139.464 26.3211 145.156 37.5C151.052 48.6789 154 60.3659 154 72.561C154 86.3821 150.341 99.2886 143.022 111.28C135.703 123.069 125.741 132.52 113.137 139.634C100.735 146.545 87.2158 150 72.5782 150ZM80.8119 143.902C97.6858 143.902 111.104 138.313 121.065 127.134C131.23 115.955 136.313 100.407 136.313 80.4878C136.313 66.8699 133.873 54.4715 128.994 43.2927C124.115 31.9106 116.898 22.8659 107.343 16.1585C97.7875 9.45122 86.301 6.09756 72.8832 6.09756C55.3993 6.09756 41.7782 11.687 32.0198 22.8659C22.4647 34.0447 17.6871 49.3902 17.6871 68.9024C17.6871 82.7236 20.1267 95.3252 25.0059 106.707C30.0884 118.089 37.4073 127.134 46.9624 133.841C56.5175 140.549 67.8007 143.902 80.8119 143.902Z"/>
                </g>
              </svg>);
            }
            const r=Math.max(2,Math.round(w*.07));
            const d=SP3[suit],[,,vw,vh]=d.vb.split(" ").map(Number);
            const ink=RED3.has(suit)?"#8b1212":"#0a0908";
            const cw=w*.42,ch=cw*vh/vw,fs=Math.round(w*.22);
            const cx=w*.14,ry=h*.19,cs=Math.round(w*.18),sy=h*.33;
            const rs=(x,y,iw,rot=false)=>{
              const sc=iw/vw,px=x+iw/2,py=y+(iw*vh/vw)/2;
              const tf=rot?`rotate(180,${px},${py}) translate(${x},${y}) scale(${sc})`:`translate(${x},${y}) scale(${sc})`;
              return <g transform={tf} fill={ink}>{d.p.map((p,i)=><path key={i} d={p}/>)}{d.c.map((c,i)=><circle key={"c"+i} cx={c.cx} cy={c.cy} r={c.r}/>)}</g>;
            };
            return (<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block",position:"absolute",top:0,left:0}}>
              <rect width={w} height={h} rx={r} fill="#fdfaf5" stroke="rgba(10,10,10,0.1)" strokeWidth="0.8"/>
              <rect x={w*.07} y={h*.05} width={w*.86} height={h*.9} rx={r*.5} fill="none" stroke="rgba(10,10,10,0.06)" strokeWidth="0.5"/>
              <text x={cx} y={ry} fontSize={fs} fill={ink} fontFamily="'Cormorant Unicase',serif" fontWeight="400">{rank}</text>
              {rs(cx-cs*.1,sy-cs*.25,cs)}
              <text x={w-cx} y={h-ry} fontSize={fs} fill={ink} fontFamily="'Cormorant Unicase',serif" fontWeight="400" textAnchor="middle" transform={`rotate(180,${w-cx},${h-ry})`}>{rank}</text>
              {rs(w-cx-cs*.9,h-sy-cs*.75,cs,true)}
              {rs((w-cw)/2,(h-ch)/2,cw)}
            </svg>);
          };

          const suitSym = s => s==="spades"?"♠":s==="hearts"?"♥":s==="diamonds"?"♦":"♣";
          const tumble = (card, w, h, flip, tilt=0) => {
            const a=((flip%360)+360)%360;
            const sx=Math.cos(a*Math.PI/180);
            const showBack=a>90&&a<270;
            const glow=Math.max(0,1-Math.abs(sx)*6);
            const cardStr = card.rank + suitSym(card.suit);
            return (
              <div style={{width:w,height:h,position:"relative",flexShrink:0,
                transform:`scaleX(${sx}) scaleY(${Math.cos(tilt*Math.PI/180)})`,
                filter:glow>.08?`drop-shadow(0 0 10px rgba(255,255,255,${(glow*.5).toFixed(2)}))`:"none",
                willChange:"transform"}}>
                {showBack
                  ? <RbnBack w={w} h={h}/>
                  : <RbnFace rank={card.rank} suit={card.suit} w={w} h={h}/>
                }
              </div>
            );
          };

          // Lemniscate centered at π/2
          const AX=160, AY=240;
          const lemX=a=>{ const d=1+Math.sin(a)*Math.sin(a); return AX*Math.sin(a)*Math.cos(a)/d; };
          const lemY=a=>{ const d=1+Math.sin(a)*Math.sin(a); return AY*Math.cos(a)/d; };
          const GAP=0.048, TRAVEL=1.6, FLIP_SPD=560;
          const T_STREAM=0.8;

          // Flip angle for reveal card
          const T_FLIP_START = T_STREAM + GAP*52 + TRAVEL + 0.4;
          const T_FACE_START = T_FLIP_START + 1.8;
          const getRevealFlip = () => {
            // intro: back facing (180). return: just came back from loop, still back (180)
            if (drawPhase==="intro"||drawPhase==="return") return 180;
            // stream: not rendered as static (travels in ribbon), but keep 180 for safety
            if (drawPhase==="stream") return 180;
            if (drawPhase==="flip") {
              const p=Math.max(0,Math.min((drawT-T_FLIP_START)/1.8,1));
              const ep=p<.5?2*p*p:-1+(4-2*p)*p;
              return 180+ep*180;
            }
            return 360;
          };
          const getRevealRot = () => {
            if (drawPhase==="flip") {
              const p=Math.max(0,Math.min((drawT-T_FLIP_START)/1.8,1));
              const ep=p<.5?2*p*p:-1+(4-2*p)*p;
              return 45*(1-ep);
            }
            if (drawPhase==="face"||drawPhase==="done") return 0;
            return 45;
          };
          const revealFlip=getRevealFlip();
          const revealRot=getRevealRot();
          const revealCard=drawDeck[26]||drawDeck[0];
          // Reveal card: show at center during intro (back facing), hide during stream
          // (it travels with the ribbon), reappear at center for flip/reveal
          // Reveal card only appears after the stream cycle completes
          // During intro+stream it rides WITH the deck as card 26
          const showRevealCard=drawPhase==="return"||drawPhase==="flip"||drawPhase==="face"||drawPhase==="done"||drawAnim==="fadeout";
          // During stream the reveal card is index 51 in the deck — it rides the ribbon
          const isFacePhase=drawPhase==="face"||drawPhase==="done"||drawAnim==="fadeout";
          const revealW=isFacePhase?Math.round(CW*1.6):CW;
          const revealH=isFacePhase?Math.round(CH*1.6):CH;

          return (
            <div className={`draw-overlay ${drawAnim==="fading"?"fading":""}`} style={{
              opacity: drawAnim==="fading"?undefined:1,
            }}>
              {/* Red ambient glow */}
              <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse at 50% 50%,rgba(139,18,18,0.06) 0%,transparent 65%)",pointerEvents:"none"}}/>

              {/* Rotated ribbon stage */}
              <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
                transform:"rotate(45deg) scale(1.35)",overflow:"hidden"}}>
                {drawPhase==="stream"&&drawDeck.map((card,i)=>{
                  const lt=i*GAP,ct=drawT-T_STREAM-lt;
                  if(ct<0)return null;
                  const rawP=Math.min(ct/TRAVEL,1);
                  const p=rawP<.5?2*rawP*rawP:-1+(4-2*rawP)*rawP;
                  const startA=Math.PI/2;
                  const angle=startA+p*Math.PI*2;
                  const lx=lemX(angle),ly=lemY(angle);
                  const na=angle+.006;
                  const tangent=Math.atan2(lemY(na)-ly,lemX(na)-lx)*180/Math.PI;
                  const flip=ct*FLIP_SPD+i*18;
                  const tilt=Math.sin(angle*2)*20;
                  const dist=Math.sqrt(lx*lx+ly*ly);
                  const fadeC=Math.min(1,dist/80);
                  const fadeEnd=Math.max(0,1-(rawP-.88)*10);
                  const opacity=Math.min(rawP*10,1)*fadeC*fadeEnd;
                  if(opacity<0.01)return null;
                  return(
                    <div key={i} style={{position:"absolute",
                      transform:`translate(${lx}px,${ly}px) rotate(${tangent+90}deg)`,
                      zIndex:Math.round(p*52),opacity,
                      filter:"drop-shadow(0 3px 10px rgba(0,0,0,0.8))"}}>
                      {tumble(card,CW,CH,flip,tilt)}
                    </div>
                  );
                })}
              </div>

              {/* Reveal card — at true center, outside rotated wrapper */}
              {showRevealCard&&(
                <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
                  <div style={{
                    transform:`rotate(${revealRot}deg) scale(${isFacePhase?1.05:1})`,
                    transition:isFacePhase?"transform 0.5s cubic-bezier(0.34,1.56,0.64,1)":"transform 0.1s linear",
                    filter:isFacePhase?"drop-shadow(0 0 40px rgba(255,255,255,0.3))":"drop-shadow(0 6px 20px rgba(0,0,0,0.6))",
                  }}>
                    {tumble(revealCard, revealW, revealH, revealFlip, 0)}
                  </div>
                </div>
              )}

              {/* "your card" label — fades in with face */}
              {isFacePhase&&(
                <div style={{
                  position:"absolute",top:"58%",left:0,right:0,textAlign:"center",
                  fontFamily:"'Montserrat',sans-serif",fontSize:"7px",
                  letterSpacing:"0.28em",textTransform:"uppercase",
                  color:"rgba(255,255,255,0.35)",
                  animation:"drawFadeIn 0.8s ease forwards",
                }}>your card</div>
              )}
            </div>
          );
        })()}

        </div>{/* end .desktop-center */}

        {/* Bottom Nav — mobile only */}
        <nav className="bottom-nav">
          {/* ♠ Today */}
          <button className={`bnav-item ${activeTab==="home"?"active":""}`} onClick={()=>setActiveTab("home")}>
            <NavIcon tab="home"/>
            <span className="bnav-label">Offering</span>
          </button>
          {/* Oracle star, 2nd slot */}
          <button className={`bnav-item ${activeTab==="veil"?"active":""}`} onClick={()=>setActiveTab("veil")}>
            <SuitIcon suit="diamond" size={16} style={{color: activeTab==="veil" ? "var(--red-suit)" : "currentColor"}}/>
            <span className="bnav-label">Oblivion</span>
          </button>
          {/* Pull / Oracle center button — routes based on today's pull status */}
          <div className="bnav-item bnav-pull">
            <button
              className={`bnav-pull-inner ${activeTab==="pull"||activeTab==="reading"?"active":""} ${!todayPull?"beckoning":""}`}
              onClick={()=>{
                if (todayPull) {
                  // Already pulled — go straight to today's reading + Oracle chat
                  setActiveTab("reading");
                } else {
                  // No pull yet — go to pull form
                  setPullDeck(defaultDeck); setPullStyle(defaultStyle);
                  setPullMode("manual"); setRandomCard(null);
                  setShowReveal(false); setPullCard("");
                  setActiveTab("pull");
                }
              }}>
              <PullIcon/>
            </button>
            <span className="bnav-pull-label" style={{color: !todayPull ? "#fff" : "var(--silver)"}}>Oracle</span>
          </div>
          {/* Club — Vault, 4th slot */}
          <button className={`bnav-item ${activeTab==="archive"?"active":""}`} onClick={()=>setActiveTab("archive")}>
            <SuitIcon suit="club" size={16} style={{color:"currentColor"}}/>
            <span className="bnav-label">Observatory</span>
          </button>
          {/* ♥ You */}
          <button className={`bnav-item ${activeTab==="profile"?"active":""}`} onClick={()=>setActiveTab("profile")}>
            <NavIcon tab="profile" active={activeTab==="profile"}/>
            <span className="bnav-label">Origin</span>
          </button>
        </nav>
      </div>



    </>
    </DarkContext.Provider>
  );
}
