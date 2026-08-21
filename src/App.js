import { useState, useEffect, useCallback, useRef } from "react";

// ─── Supabase ────────────────────────────────────────────────────
const SUPABASE_URL = "https://edkhaaijlicwfqfmalff.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVka2hhYWlqbGljd2ZxZm1hbGZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMTgzNTksImV4cCI6MjA5MTU5NDM1OX0.Hq5aNZluv3oVq6IaD3EaAqqDougpFwyQYUie8ixfgi0";

async function sbFetch(path, options={}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
      ...(options.headers||{}),
    },
  });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

async function loadRecords() {
  const data = await sbFetch("records?user_id=eq.family&order=timestamp.desc&limit=1000", {
    headers: { "Prefer": "" }
  });
  return data || [];
}

async function loadSleep() {
  const data = await sbFetch("sleep_sessions?user_id=eq.family&order=start_time.desc&limit=200", {
    headers: { "Prefer": "" }
  });
  if (!data) return [];
  return data.map(s => ({ id: s.id, start: s.start_time, end: s.end_time || null, operator: s.operator || null }));
}

async function upsertRecord(rec) {
  await sbFetch("records", {
    method: "POST",
    headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: String(rec.id), user_id: "family", key: rec.key,
      timestamp: rec.timestamp, label: rec.label || "",
      ml: rec.ml || null, value: rec.value || null,
      unit: rec.unit || null, note: rec.note || null,
      operator: rec.operator || null,
    }),
  });
}

async function deleteRecord(id) {
  await sbFetch(`records?id=eq.${encodeURIComponent(String(id))}`, { method: "DELETE" });
}

async function upsertSleep(s) {
  await sbFetch("sleep_sessions", {
    method: "POST",
    headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: s.id, user_id: "family",
      start_time: s.start, end_time: s.end || null,
      operator: s.operator || null,
    }),
  });
}

async function deleteSleepDb(id) {
  await sbFetch(`sleep_sessions?id=eq.${id}`, { method: "DELETE" });
}

// ─── 操作ログ ─────────────────────────────────────────────────────
async function addLog(operator, action, targetId, detail) {
  await sbFetch("logs", {
    method: "POST",
    body: JSON.stringify({
      user_id: "family", operator: operator || "不明", action,
      target_id: targetId != null ? String(targetId) : null,
      detail: detail || null,
    }),
  });
}

async function loadLogs() {
  const data = await sbFetch("logs?user_id=eq.family&order=created_at.desc&limit=150", {
    headers: { "Prefer": "" }
  });
  return data || [];
}

// ─── 引き継ぎメモ ─────────────────────────────────────────────────
async function loadMemos() {
  const data = await sbFetch("memos?content=neq.&order=updated_at.desc&limit=3", { headers: { "Prefer": "" } });
  return data || [];
}

async function saveMemoDb(memo) {
  await sbFetch("memos", {
    method: "POST",
    body: JSON.stringify(memo),
  });
}

// ─── プッシュ通知 ─────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = "BOf1p13V-69m8Qx-9mfjEYRWcsnBQZQt8W7AulVwK4lVK3dzRhWUkIRzWEaSn2acpjAjNU6x_lnChrbgkJh5OFw";

async function subscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: VAPID_PUBLIC_KEY,
  });
  await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub),
  });
  return sub;
}

// ─── GAS ────────────────────────────────────────────────────────
const GAS_URL = "https://script.google.com/macros/s/AKfycbxZOQkI6I7WdtuJpYYJgRDerxsylJU8F66FPL_yJC71g234e7sEuIPa1e12pV87Zk0m/exec";

function gasPost(body) {
  if (!GAS_URL || GAS_URL === "YOUR_GAS_URL_HERE") return;
  fetch(GAS_URL, { method: "POST", body: JSON.stringify(body) })
    .catch(e => console.log("GAS error:", e));
}

const APP_VERSION = "v3.6";

// ─── Storage keys ───────────────────────────────────────────────
const SK = "bt_records";
const SLEEP_SK = "bt_sleep";
const REM_SK = "bt_reminders";
const OP_SK = "bt_operator";

// ─── 操作者 ──────────────────────────────────────────────────────
const OPERATORS = [
  { label:"ママ",       emoji:"👩", color:"#F08080" },
  { label:"パパ",       emoji:"👨", color:"#3E8FC7" },
  { label:"おじいちゃん", emoji:"👴", color:"#7C6FCD" },
  { label:"おばあちゃん", emoji:"👵", color:"#E8845C" },
];
const opByLabel = (label) => OPERATORS.find(o=>o.label===label) || { label: label||"？", emoji:"👤", color:"#999" };

const ACTION_LABELS = {
  add_record:    "記録",
  delete_record: "記録を削除",
  sleep_start:   "就寝",
  sleep_end:     "起床",
  sleep_manual:  "睡眠を手動記録",
  delete_sleep:  "睡眠を削除",
  memo_update:   "引き継ぎメモを更新",
  clear_records: "記録を全削除",
  clear_sleep:   "睡眠記録を全削除",
  operator_change:"操作者を変更",
};

const CATS = {
  nursing: {
    label: "食事", color: "#E8845C", icon: "🍽️", bg: "#FFF4EE",
    items: [
      { key: "breastfeed", label: "母乳", emoji: "🤱", color: "#F08080" },
      { key: "milk",       label: "ミルク", emoji: "🍼", color: "#F4A261", hasMl: true },
      { key: "pumped",     label: "搾母乳", emoji: "🥛", color: "#FFB347", hasMl: true },
      { key: "weaning",    label: "離乳食", emoji: "🥄", color: "#A8D8A8" },
      { key: "snack",      label: "おやつ", emoji: "🍪", color: "#D4A0C7" },
      { key: "meal",       label: "ごはん", emoji: "🍚", color: "#98C8A8" },
      { key: "drink",      label: "のみもの", emoji: "🥤", color: "#87CEEB" },
    ],
  },
  excretion: {
    label: "排泄", color: "#4ECDC4", icon: "🚼", bg: "#EEFAF9",
    items: [
      { key: "pee",     label: "おしっこ", emoji: "💧", color: "#4ECDC4" },
      { key: "poo",     label: "うんち",   emoji: "💩", color: "#C8A870" },
      { key: "pee_poo", label: "両方",     emoji: "💧💩", color: "#88B8A8" },
    ],
  },
  health: {
    label: "健康", color: "#FF8C8C", icon: "🩺", bg: "#FFF0F0",
    items: [
      { key: "temp",    label: "体温",   emoji: "🌡️", color: "#FF8C8C", hasValue: true, unit: "℃", placeholder: "36.5" },
      { key: "height",  label: "身長",   emoji: "📏", color: "#98C8D8", hasValue: true, unit: "cm", placeholder: "50.0" },
      { key: "weight",  label: "体重",   emoji: "⚖️", color: "#98D8B8", hasValue: true, unit: "kg", placeholder: "3.2" },
      { key: "head",    label: "頭囲",   emoji: "🟤", color: "#C8A870", hasValue: true, unit: "cm", placeholder: "34.0" },
      { key: "chest",   label: "胸囲",   emoji: "🟠", color: "#F4A261", hasValue: true, unit: "cm", placeholder: "33.0" },
      { key: "cough",   label: "せき",   emoji: "😮‍💨", color: "#C0A8D8" },
      { key: "vomit",   label: "吐く",   emoji: "🤢", color: "#B8D870" },
      { key: "rash",    label: "発疹",   emoji: "🔴", color: "#FF9898" },
      { key: "injury",  label: "けが",   emoji: "🩹", color: "#FFB8A8" },
      { key: "medicine",label: "くすり", emoji: "💊", color: "#98C8D8" },
    ],
  },
  activity: {
    label: "活動", color: "#7C6FCD", icon: "🎈", bg: "#F2F0FC",
    items: [
      { key: "bath",    label: "お風呂",  emoji: "🛁", color: "#87CEEB" },
      { key: "walk",    label: "さんぽ",  emoji: "👣", color: "#98D898" },
      { key: "hospital",label: "病院",   emoji: "🏥", color: "#C8A8D8" },
      { key: "vaccine", label: "予防接種",emoji: "💉", color: "#A8C8F8" },
      { key: "achieved",label: "できた",  emoji: "⭐", color: "#FFD700" },
      { key: "other",   label: "その他",  emoji: "•••", color: "#BBBBBB" },
    ],
  },
};

const ALL_ITEMS = Object.values(CATS).flatMap((c) => c.items);
const itemByKey = (key) => ALL_ITEMS.find((i) => i.key === key) || { label: key, emoji: "•", color: "#999" };
const ML_OPTIONS = [0,5,10,15,20,30,40,50,60,70,80,90,100,110,120,130,140,150,160,170,180,200,220,240,260,280,300];

const fmt = (d) => new Intl.DateTimeFormat("ja-JP",{hour:"2-digit",minute:"2-digit"}).format(new Date(d));
const fmtDateTime = (d) => new Intl.DateTimeFormat("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(d));
const fmtDate = (d) => {
  const diff = Math.floor((Date.now()-new Date(d).getTime())/86400000);
  if(diff===0) return "今日";
  if(diff===1) return "昨日";
  return new Intl.DateTimeFormat("ja-JP",{month:"numeric",day:"numeric"}).format(new Date(d));
};
const fmtDur = (ms) => {
  if(!ms||ms<0) return "--";
  const m=Math.floor(ms/60000), h=Math.floor(m/60);
  return h?`${h}時間${m%60}分`:`${m}分`;
};
const timeSince = (d) => {
  const mins=Math.floor((Date.now()-new Date(d).getTime())/60000);
  if(mins<1) return "たった今";
  if(mins<60) return `${mins}分前`;
  const h=Math.floor(mins/60);
  if(h<24) return `${h}時間${mins%60}分前`;
  return `${Math.floor(h/24)}日前`;
};
const todayStr = () => new Date().toDateString();

function groupByDate(items) {
  const g={};
  items.forEach((r)=>{ const k=new Date(r.timestamp).toDateString(); if(!g[k]) g[k]=[]; g[k].push(r); });
  return g;
}

function useIsWide() {
  const [wide,setWide]=useState(()=>typeof window!=="undefined"&&window.matchMedia("(min-width: 900px)").matches);
  useEffect(()=>{
    const mq=window.matchMedia("(min-width: 900px)");
    const h=e=>setWide(e.matches);
    mq.addEventListener("change",h);
    return()=>mq.removeEventListener("change",h);
  },[]);
  return wide;
}

// PC用の拡大率：画面幅1200pxで1.3倍、幅が広いほど大きく（最大2.2倍）
function useZoom(wide) {
  const calc=()=>{ if(!wide) return 1; const w=window.innerWidth; return Math.min(2.2, Math.max(1.3, w/950)); };
  const [z,setZ]=useState(calc);
  useEffect(()=>{
    const h=()=>setZ(calc());
    h(); window.addEventListener("resize",h);
    return()=>window.removeEventListener("resize",h);
    // eslint-disable-next-line
  },[wide]);
  return z;
}

function useTick(active) {
  const [,set]=useState(0);
  useEffect(()=>{ if(!active) return; const id=setInterval(()=>set(t=>t+1),15000); return()=>clearInterval(id); },[active]);
}

const mapRecs = (recs) => recs.map(r=>({
  id: r.id, key: r.key, timestamp: r.timestamp,
  label: r.label, ml: r.ml, value: r.value, unit: r.unit, note: r.note, operator: r.operator || null,
}));

function useGlobalStyle() {
  useEffect(()=>{
    if(document.getElementById("fk-font")) return;
    const l=document.createElement("link"); l.id="fk-font"; l.rel="stylesheet";
    l.href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700;900&display=swap";
    document.head.appendChild(l);
    const c=document.createElement("style"); c.id="fk-css";
    c.textContent=`
      body{margin:0;background:#F4FAFE;}
      button{font-family:inherit;}
      button:active{transform:scale(.96);}
      *::-webkit-scrollbar{width:8px;height:8px}
      *::-webkit-scrollbar-thumb{background:#CFE3F0;border-radius:8px}
      input,textarea,select{font-family:inherit;}
    `;
    document.head.appendChild(c);
  },[]);
}

export default function BabyTracker() {
  useGlobalStyle();
  const [records, setRecords] = useState([]);
  const [sleep, setSleep]     = useState([]);
  const [reminders, setRem]   = useState(()=>{ try{return JSON.parse(localStorage.getItem(REM_SK)||"{}")}catch{return{}} });
  const [loading, setLoading] = useState(true);
  const [view, setView]       = useState("home");
  const [mlModal, setMlModal] = useState(null);
  const [valModal, setValModal]= useState(null);
  const [valInput, setValInput]= useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualKey,  setManualKey]  = useState(null);
  const [manualTime, setManualTime] = useState("");
  const [manualMl,   setManualMl]   = useState(null);
  const [manualVal,  setManualVal]  = useState("");
  const [manualNote, setManualNote] = useState("");
  const [sleepManual,setSleepManual]= useState(false);
  const [smStart,setSmStart]=useState("");
  const [smEnd,setSmEnd]=useState("");
  const [justDone, setJustDone] = useState(null);
  const [alerts, setAlerts]     = useState({});
  const [otherModal, setOtherModal] = useState(false);
  const [otherText,  setOtherText]  = useState("");

  // 操作者
  const [operator, setOperator] = useState(()=>localStorage.getItem(OP_SK)||null);
  const [opModal, setOpModal]   = useState(false);
  const opRef = useRef(operator);
  useEffect(()=>{ opRef.current = operator; },[operator]);

  // 引き継ぎメモ
  const [memos, setMemos]         = useState([]);
  const memo = memos[0] || { content:"", operator:null, updated_at:null, from_op:null, to_op:null };
  const [memoEditing, setMemoEditing] = useState(false);   // false | "who" | "write"
  const [memoInput, setMemoInput] = useState("");
  const [memoFrom, setMemoFrom]   = useState(null);
  const [memoTo, setMemoTo]       = useState(null);
  const [memoSaving, setMemoSaving] = useState(false);

  // 操作ログ
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const isSleeping = sleep.find(s=>!s.end)||null;
  useTick(!!isSleeping);
  const wide = useIsWide();
  const zoom = useZoom(wide);
  const [vh, setVh] = useState(()=>typeof window!=="undefined"?window.innerHeight:800);
  useEffect(()=>{ const h=()=>setVh(window.innerHeight); window.addEventListener("resize",h); return()=>window.removeEventListener("resize",h); },[]);
  const HEADER_H = 98;
  const rightH = Math.floor(vh/zoom) - HEADER_H - 28;

  // 初回ロード：Supabaseから取得
  useEffect(()=>{
    (async()=>{
      setLoading(true);
      const [recs, slps, m] = await Promise.all([loadRecords(), loadSleep(), loadMemos()]);
      if(recs.length > 0) {
        setRecords(mapRecs(recs));
      } else {
        const local = JSON.parse(localStorage.getItem(SK)||"[]");
        setRecords(local);
      }
      if(slps.length > 0) {
        setSleep(slps);
      } else {
        const local = JSON.parse(localStorage.getItem(SLEEP_SK)||"[]");
        setSleep(local);
      }
      setMemos(m);
      setLoading(false);
    })();
  },[]);

  // 30秒ごとに最新データを取得（他デバイスの更新を反映）
  useEffect(()=>{
    const id = setInterval(async()=>{
      const [recs, slps, m] = await Promise.all([loadRecords(), loadSleep(), loadMemos()]);
      if(recs.length >= 0) setRecords(mapRecs(recs));
      if(slps.length >= 0) setSleep(slps);
      if(!memoEditing) setMemos(m);
    }, 30000);
    return()=>clearInterval(id);
  },[memoEditing]);

  // 設定タブを開いたときにログを読み込む
  useEffect(()=>{
    if(view!=="settings") return;
    (async()=>{ setLogsLoading(true); setLogs(await loadLogs()); setLogsLoading(false); })();
  },[view]);

  useEffect(()=>{ localStorage.setItem(REM_SK,JSON.stringify(reminders)); },[reminders]);

  useEffect(()=>{
    subscribePush().catch(e => console.log('Push subscribe error:', e));
  }, []);

  useEffect(()=>{
    const check=()=>{
      const na={};
      Object.entries(reminders).forEach(([k,mins])=>{
        if(!mins) return;
        const last=records.filter(r=>r.key===k).sort((a,b)=>b.timestamp-a.timestamp)[0];
        if(!last) return;
        const diff=(Date.now()-last.timestamp)/60000;
        if(diff>=mins) na[k]=Math.floor(diff);
      });
      setAlerts(na);
    };
    check();
    const id=setInterval(check,60000);
    return()=>clearInterval(id);
  },[records,reminders]);

  const flash = (k) => { setJustDone(k); setTimeout(()=>setJustDone(null),1200); };

  const chooseOperator = (label) => {
    const prev = opRef.current;
    setOperator(label);
    localStorage.setItem(OP_SK, label);
    setOpModal(false);
    if(prev && prev!==label) addLog(label, "operator_change", null, { from: prev, to: label });
  };

  const addRecord = useCallback(async(key,extra={},ts=Date.now())=>{
    const op = opRef.current;
    const it = itemByKey(key);
    const rec = {id:Date.now()+Math.random(),key,timestamp:ts,operator:op,...extra};
    setRecords(prev=>[rec,...prev].slice(0,1000));
    flash(key);
    const recWithLabel = { ...rec, label: it.label };
    await upsertRecord(recWithLabel);
    gasPost({ action:"add", record:{ ...recWithLabel, unit:extra.unit||"" } });
    addLog(op, "add_record", rec.id, { label: it.label, ml: extra.ml ?? null, value: extra.value ?? null, unit: extra.unit ?? null, note: extra.note ?? null, timestamp: ts });
  },[]);

  const delRecord = async(id) => {
    const target = records.find(r=>r.id===id);
    setRecords(prev=>prev.filter(r=>r.id!==id));
    await deleteRecord(id);
    gasPost({ action:"delete", id });
    const it = target ? itemByKey(target.key) : null;
    addLog(opRef.current, "delete_record", id, target ? { label: it.label, ml: target.ml ?? null, value: target.value ?? null, unit: target.unit ?? null, note: target.note ?? null, timestamp: target.timestamp, recorded_by: target.operator ?? null } : null);
  };

  const handleTap = (item) => {
    if(item.key==="other") { setOtherModal(true); setOtherText(""); return; }
    if(item.hasMl) { setMlModal(item); return; }
    if(item.hasValue) { setValModal(item); setValInput(""); return; }
    addRecord(item.key);
  };

  const confirmMl = (ml) => { addRecord(mlModal.key,{ml}); setMlModal(null); };
  const confirmVal = () => {
    if(!valInput) { setValModal(null); return; }
    addRecord(valModal.key,{value:valInput,unit:valModal.unit});
    setValModal(null); setValInput("");
  };

  const startSleep = async(ts=Date.now()) => {
    if(isSleeping) return;
    const op = opRef.current;
    const s = {id:Date.now(),start:ts,end:null,operator:op};
    setSleep(prev=>[s,...prev]);
    flash("sleep");
    await upsertSleep(s);
    gasPost({ action:"addSleep", session:s });
    addLog(op, "sleep_start", s.id, { start: ts });
  };
  const endSleep = async(ts=Date.now()) => {
    if(!isSleeping) return;
    const op = opRef.current;
    const updated = {...isSleeping, end:ts};
    setSleep(prev=>prev.map(s=>!s.end?updated:s));
    flash("wake");
    await upsertSleep(updated);
    gasPost({ action:"updateSleep", session:updated });
    addLog(op, "sleep_end", updated.id, { start: updated.start, end: ts, duration_min: Math.round((ts-updated.start)/60000) });
  };
  const delSleep = async(id) => {
    const target = sleep.find(s=>s.id===id);
    setSleep(prev=>prev.filter(s=>s.id!==id));
    await deleteSleepDb(id);
    gasPost({ action:"deleteSleep", id });
    addLog(opRef.current, "delete_sleep", id, target ? { start: target.start, end: target.end, recorded_by: target.operator ?? null } : null);
  };
  const addSleepManual=async()=>{
    if(!smStart) return;
    const op = opRef.current;
    const s = {id:Date.now(),start:new Date(smStart).getTime(),end:smEnd?new Date(smEnd).getTime():null,operator:op};
    setSleep(prev=>[s,...prev]);
    setSleepManual(false); setSmStart(""); setSmEnd("");
    await upsertSleep(s);
    gasPost({ action:"addSleep", session:s });
    addLog(op, "sleep_manual", s.id, { start: s.start, end: s.end });
  };
  const submitManual=()=>{
    if(!manualKey||!manualTime) return;
    const ts=new Date(manualTime).getTime();
    const extra={};
    if(manualMl!=null) extra.ml=manualMl;
    if(manualVal) extra.value=manualVal;
    if(manualNote) extra.note=manualNote;
    addRecord(manualKey,extra,ts);
    setManualOpen(false); setManualKey(null); setManualTime(""); setManualMl(null); setManualVal(""); setManualNote("");
  };

  const startMemoEdit = () => {
    setMemoInput("");
    setMemoFrom(opRef.current);
    setMemoTo(memo.to_op && memo.to_op!==opRef.current ? memo.to_op : null);
    setMemoEditing("who");
  };
  const saveMemo = async() => {
    const op = opRef.current;
    const content = memoInput.trim();
    if(!content){ setMemoEditing(false); return; }
    setMemoSaving(true);
    const now = new Date().toISOString();
    const row = { id:`memo_${Date.now()}`, content, operator: op, updated_at: now, from_op: memoFrom, to_op: memoTo };
    await saveMemoDb(row);
    setMemos(prev=>[row,...prev].slice(0,3));
    setMemoEditing(false);
    setMemoSaving(false);
    addLog(op, "memo_update", "family", { content, from: memoFrom, to: memoTo });
  };

  const clearRecords = async() => {
    if(!confirm("記録をすべて削除？（全端末から消えます）")) return;
    setRecords([]);
    await sbFetch("records?user_id=eq.family", { method:"DELETE" });
    addLog(opRef.current, "clear_records", null, null);
  };
  const clearSleep = async() => {
    if(!confirm("睡眠記録をすべて削除？（全端末から消えます）")) return;
    setSleep([]);
    await sbFetch("sleep_sessions?user_id=eq.family", { method:"DELETE" });
    addLog(opRef.current, "clear_sleep", null, null);
  };

  const todayCount = (key)=>records.filter(r=>r.key===key&&new Date(r.timestamp).toDateString()===todayStr()).length;
  const lastOf     = (key)=>records.find(r=>r.key===key);
  const todayMl = records.filter(r=>r.key==="milk"&&new Date(r.timestamp).toDateString()===todayStr()).reduce((a,r)=>a+(r.ml||0),0);
  const todaySleepMs=sleep.filter(s=>s.end&&new Date(s.start).toDateString()===todayStr()).reduce((a,s)=>a+(s.end-s.start),0);

  const allItems=[
    ...records.map(r=>({...r,itemType:"record"})),
    ...sleep.flatMap(s=>{
      const arr=[{id:s.id+"_s",itemType:"sleep_start",timestamp:s.start,sessionId:s.id,operator:s.operator}];
      if(s.end) arr.push({id:s.id+"_e",itemType:"sleep_end",timestamp:s.end,sessionId:s.id,duration:s.end-s.start,operator:s.operator});
      return arr;
    }),
  ].sort((a,b)=>b.timestamp-a.timestamp);
  const groupedAll=groupByDate(allItems);
  const SLEEP_C="#7C6FCD";
  const curOp = opByLabel(operator);

  const ovl = wide ? {...st.overlay, alignItems:"center"} : st.overlay;
  const mdl = wide ? {...st.modal, borderRadius:24, maxWidth:560, maxHeight:"80vh", padding:28, boxShadow:"0 16px 48px rgba(0,0,0,.3)"} : st.modal;
  const mTitle = wide ? {...st.modalTitle, fontSize:26} : st.modalTitle;
  const OpTag = ({ label }) => {
    if(!label) return null;
    const o = opByLabel(label);
    return <span style={{...st.opTag, background:o.color, fontSize:wide?13:10, padding:wide?"3px 10px":"1px 7px"}}>{o.emoji} {o.label}</span>;
  };

  if(loading) return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#F4FAFE",flexDirection:"column",gap:12}}>
      <div style={{fontSize:56}}>🐣</div>
      <div style={{fontSize:16,color:"#888"}}>データを読み込み中...</div>
    </div>
  );

  // 操作者選択モーダル（初回 or 切り替え）
  const showOpModal = !operator || opModal;

  return (
    <div style={{...st.app,zoom}}>
      {Object.keys(alerts).length>0&&(
        <div style={st.alertBar}>
          {Object.entries(alerts).map(([k,m])=>{
            const it=itemByKey(k);
            return <span key={k} style={st.alertItem}>{it.emoji} {it.label}から{m}分</span>;
          })}
        </div>
      )}
      <header style={st.header}>
        <div style={{...st.headerIn,maxWidth:wide?"none":520,padding:wide?"20px 28px":"12px 14px"}}>
          <span style={{...st.logo,fontSize:wide?34:22,fontFamily:"'Hiragino Maru Gothic ProN','Hiragino Sans','Noto Sans JP',sans-serif"}}>🐥 千隼くん <span style={{fontSize:12,color:"rgba(255,255,255,.75)",fontWeight:500}}>{APP_VERSION}</span></span>
          <div style={{display:"flex",alignItems:"center",gap:wide?14:6}}>
            <nav style={{...st.nav,padding:wide?4:3}}>
              {[["home","🍼 記録"],["history","📖 履歴"],["summary","📈 グラフ"],["settings","⚙️ 設定"]].map(([v,l])=>(
                <button key={v} onClick={()=>setView(v)} style={{...st.navBtn,fontSize:wide?19:13,padding:wide?"11px 20px":"6px 11px",...(view===v?st.navActive:{})}}>{l}</button>
              ))}
            </nav>
            <button onClick={()=>setOpModal(true)} title="操作者を切り替え"
              style={{...st.opBtn, background:"white", borderColor:"white", color:curOp.color, fontSize:wide?19:12, padding:wide?"11px 20px":"6px 12px"}}>
              {curOp.emoji} {curOp.label}
            </button>
          </div>
        </div>
      </header>
      <main style={{...st.main,maxWidth:wide?"none":520,padding:wide?"20px 20px":14,width:"100%",boxSizing:"border-box"}}>
        {view==="home"&&(
          <div style={wide?st.homeWide:st.section}>
          <div style={{...st.section,...(wide?{order:2,gap:16,position:"sticky",top:HEADER_H+6,height:rightH,overflow:"hidden"}:{})}}>
            {/* 引き継ぎメモ */}
            <div style={{...st.memoCard,padding:wide?24:14,gap:wide?14:8,borderWidth:wide?2.5:1.5,...(wide?{flex:1,minHeight:0,overflowY:"auto",boxSizing:"border-box"}:{})}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:wide?26:13,fontWeight:800,color:"#8A6D1F"}}>📝 引き継ぎメモ</span>
                {!memoEditing&&<button onClick={startMemoEdit} style={{...st.memoEditBtn,fontSize:wide?16:12,padding:wide?"10px 22px":"4px 12px",background:"#8A6D1F",color:"white",borderColor:"#8A6D1F"}}>＋ 新しく書く</button>}
              </div>
              {memoEditing==="who"&&(
                <>
                  <div style={{fontSize:wide?15:12,fontWeight:700,color:"#8A6D1F"}}>だれから</div>
                  <div style={st.whoGrid}>
                    {OPERATORS.map(o=>(
                      <button key={o.label} onClick={()=>setMemoFrom(o.label)}
                        style={{...st.whoBtn,borderColor:o.color,background:memoFrom===o.label?o.color:"white",color:memoFrom===o.label?"white":o.color,fontSize:wide?15:12}}>
                        {o.emoji} {o.label}
                      </button>
                    ))}
                  </div>
                  <div style={{fontSize:wide?15:12,fontWeight:700,color:"#8A6D1F"}}>だれへ</div>
                  <div style={st.whoGrid}>
                    {OPERATORS.map(o=>(
                      <button key={o.label} onClick={()=>setMemoTo(o.label)}
                        style={{...st.whoBtn,borderColor:o.color,background:memoTo===o.label?o.color:"white",color:memoTo===o.label?"white":o.color,fontSize:wide?15:12}}>
                        {o.emoji} {o.label}
                      </button>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>setMemoEditing("write")} disabled={!memoFrom||!memoTo} style={{...st.submitBtn,flex:1,background:"#8A6D1F",padding:wide?14:10,fontSize:wide?17:15,opacity:(!memoFrom||!memoTo)?.4:1}}>次へ：内容を書く →</button>
                    <button onClick={()=>setMemoEditing(false)} style={{...st.cancelBtn,marginTop:0,padding:wide?14:10}}>キャンセル</button>
                  </div>
                </>
              )}
              {memoEditing==="write"&&(
                <>
                  <div style={{fontSize:wide?16:13,fontWeight:700,color:"#555",display:"flex",alignItems:"center",gap:8}}>
                    <OpTag label={memoFrom}/> → <OpTag label={memoTo}/>
                    <button onClick={()=>setMemoEditing("who")} style={{...st.memoEditBtn,marginLeft:"auto"}}>変更</button>
                  </div>
                  <textarea value={memoInput} onChange={e=>setMemoInput(e.target.value)} rows={wide?10:6}
                    placeholder={`${memoTo}へ\n例：17時にミルク120ml済み\nうんち少なめ、機嫌よし\n次は20時ごろミルク`}
                    style={{...st.input,resize:"vertical",fontSize:wide?17:15,lineHeight:1.6}} autoFocus/>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={saveMemo} disabled={memoSaving} style={{...st.submitBtn,flex:1,background:"#8A6D1F",padding:wide?14:10,fontSize:wide?17:15}}>{memoSaving?"保存中...":"保存する"}</button>
                    <button onClick={()=>setMemoEditing(false)} style={{...st.cancelBtn,marginTop:0,padding:wide?14:10}}>キャンセル</button>
                  </div>
                </>
              )}
              {!memoEditing&&memos.length===0&&(
                <div style={{fontSize:wide?20:14,color:"#AAA",padding:wide?"24px 0":"8px 0",textAlign:wide?"center":"left"}}>まだメモはありません。「新しく書く」から次の担当者への申し送りを残せます。</div>
              )}
              {!memoEditing&&memos.map((m,i)=>(
                <div key={m.id} style={{background:i===0?"white":"rgba(255,255,255,.55)",border:i===0?"2px solid #E8C860":"1px solid #EEDFA8",borderRadius:14,padding:wide?(i===0?20:14):12,display:"flex",flexDirection:"column",gap:8,opacity:i===0?1:.85}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    {i===0&&<span style={{fontSize:wide?12:10,fontWeight:700,color:"white",background:"#E8A030",borderRadius:8,padding:"2px 8px"}}>最新</span>}
                    <OpTag label={m.from_op}/> <span style={{color:"#999"}}>→</span> <OpTag label={m.to_op}/>
                    <span style={{marginLeft:"auto",fontSize:wide?14:11,color:"#888",fontWeight:600}}>{fmtDateTime(m.updated_at)}</span>
                  </div>
                  <div style={{fontSize:wide?(i===0?20:16):(i===0?15:13),lineHeight:1.7,whiteSpace:"pre-wrap",color:"#2D2D2D"}}>{m.content}</div>
                </div>
              ))}
            </div>
            <div style={wide?{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,alignItems:"stretch",flexShrink:0}:{display:"flex",flexDirection:"column",gap:14}}>
            {/* 今日のまとめ */}
            <div style={{background:"white",border:"1px solid #EBEBEB",borderRadius:wide?20:14,padding:wide?20:12,display:"flex",flexDirection:"column",gap:wide?12:8}}>
              <div style={{fontSize:wide?18:13,fontWeight:800,color:"#555"}}>📊 今日のまとめ</div>
              <div style={{display:"grid",gridTemplateColumns:wide?"repeat(2,1fr)":"repeat(3,1fr)",gap:wide?10:6,flex:1}}>
                {[
                  {label:"ミルク",value:`${todayMl}ml`,sub:`${todayCount("milk")}回`,color:"#F4A261",emoji:"🍼"},
                  {label:"母乳",value:`${todayCount("breastfeed")}回`,sub:lastOf("breastfeed")?timeSince(lastOf("breastfeed").timestamp):"–",color:"#F08080",emoji:"🤱"},
                  {label:"睡眠",value:todaySleepMs>0?fmtDur(todaySleepMs):"0分",sub:`${sleep.filter(s=>s.end&&new Date(s.start).toDateString()===todayStr()).length}回`,color:SLEEP_C,emoji:"😴"},
                  {label:"おしっこ",value:`${todayCount("pee")+todayCount("pee_poo")}回`,sub:lastOf("pee")||lastOf("pee_poo")?timeSince(Math.max(lastOf("pee")?.timestamp||0,lastOf("pee_poo")?.timestamp||0)):"–",color:"#4ECDC4",emoji:"💧"},
                  {label:"うんち",value:`${todayCount("poo")+todayCount("pee_poo")}回`,sub:lastOf("poo")||lastOf("pee_poo")?timeSince(Math.max(lastOf("poo")?.timestamp||0,lastOf("pee_poo")?.timestamp||0)):"–",color:"#C8A870",emoji:"💩"},
                  {label:"体温",value:lastOf("temp")?`${lastOf("temp").value}℃`:"–",sub:lastOf("temp")?timeSince(lastOf("temp").timestamp):"未計測",color:"#FF8C8C",emoji:"🌡️"},
                ].map(c=>(
                  <div key={c.label} style={{borderRadius:16,padding:wide?"8px 6px":"8px 6px",display:"flex",flexDirection:"column",alignItems:"center",gap:2,background:c.color+"22"}}>
                    <span style={{fontSize:wide?13:10,color:"#777",fontWeight:600}}>{c.emoji} {c.label}</span>
                    <span style={{fontSize:wide?20:16,fontWeight:800,color:c.color}}>{c.value}</span>
                    <span style={{fontSize:wide?12:9,color:"#AAA"}}>{c.sub}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{...st.sleepCard,border:"none",background:"linear-gradient(160deg,#EDE9FF,#DCD6FF)",padding:wide?22:16,justifyContent:"space-between"}}>
              <div style={{...st.sleepTop,...(wide?{flexDirection:"column",alignItems:"center",textAlign:"center",gap:8,flex:1,justifyContent:"center"}:{})}}>
                <span style={{fontSize:wide?54:30}}>{isSleeping?"😴":"☀️"}</span>
                <div style={{display:"flex",flexDirection:"column",gap:3,alignItems:wide?"center":"flex-start"}}>
                  <span style={{fontSize:wide?16:13,fontWeight:600,color:"#555"}}>睡眠</span>
                  <span style={{fontSize:wide?22:15,fontWeight:700,color:isSleeping?SLEEP_C:"#444"}}>
                    {isSleeping?`就寝中 · ${fmtDur(Date.now()-isSleeping.start)} 経過`:`今日 ${todaySleepMs>0?fmtDur(todaySleepMs):"0分"}`}
                  </span>
                </div>
              </div>
              <div style={{...st.sleepBtns,...(wide?{gridTemplateColumns:"1fr",gap:10}:{})}}>
                <button onClick={()=>startSleep()} disabled={!!isSleeping}
                  style={{...st.sleepBtn,padding:wide?14:12,fontSize:wide?18:14,background:!isSleeping?SLEEP_C:"#CCC",opacity:isSleeping?.45:1}}>😴 寝た</button>
                <button onClick={()=>endSleep()} disabled={!isSleeping}
                  style={{...st.sleepBtn,padding:wide?14:12,fontSize:wide?18:14,background:isSleeping?"#F4A261":"#CCC",opacity:!isSleeping?.45:1}}>☀️ 起きた</button>
              </div>
            </div>
            </div>
          </div>
          <div style={{...st.section,...(wide?{order:1}:{})}}>
            {Object.entries(CATS).map(([catKey,cat])=>(
              <div key={catKey} style={{...st.catBlock,padding:wide?"0 0 20px":"0 0 12px",borderRadius:wide?26:18,background:"white",overflow:"hidden"}}>
                <div style={{display:"flex",alignItems:"center",gap:10,background:cat.bg,color:cat.color,padding:wide?"12px 20px":"9px 14px",borderBottom:`3px solid ${cat.color}`}}>
                  <span style={{fontSize:wide?26:18}}>{cat.icon}</span>
                  <span style={{fontSize:wide?20:14,fontWeight:900,letterSpacing:1}}>{cat.label}</span>
                </div>
                <div style={{padding:wide?"0 20px":"0 12px"}}>
                <div style={{...st.catGrid,gridTemplateColumns:wide?"repeat(4,minmax(0,1fr))":"repeat(4,1fr)",gap:wide?14:8,marginTop:wide?16:10}}>
                  {cat.items.map((item)=>{
                    const done=justDone===item.key;
                    return (
                      <button key={item.key} onClick={()=>handleTap(item)}
                        style={{...st.itemBtn,padding:wide?"20px 8px":"12px 4px",borderWidth:0,borderRadius:wide?22:16,background:done?item.color:item.color+"22",
                          color:done?"white":"#5A4A4A",transform:done?"scale(0.94)":"scale(1)",boxShadow:done?"none":"0 2px 0 "+item.color+"66"}}>
                        <span style={{fontSize:wide?46:24,lineHeight:1}}>{item.emoji}</span>
                        <span style={{fontSize:wide?22:12,fontWeight:900,marginTop:wide?8:3}}>{item.label}</span>
                        {(item.key==="milk"||item.key==="pumped")&&<span style={{fontSize:wide?16:9,opacity:.7,fontWeight:600}}>ml選択</span>}
                        {item.key!=="milk"&&item.key!=="pumped"&&<span style={{fontSize:wide?16:9,opacity:.6,fontWeight:600}}>{lastOf(item.key)?timeSince(lastOf(item.key).timestamp):"未記録"}</span>}
                      </button>
                    );
                  })}
                </div>
                </div>
              </div>
            ))}
            <button onClick={()=>setManualOpen(v=>!v)} style={{...st.manualToggle,fontSize:wide?16:13,padding:wide?14:10}}>✏️ 時刻を指定して記録</button>
            {manualOpen&&(
              <div style={st.manualCard}>
                <p style={{margin:0,fontSize:13,color:"#888"}}>項目を選んで時刻を入力</p>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {ALL_ITEMS.map(it=>(
                    <button key={it.key} onClick={()=>setManualKey(it.key)}
                      style={{...st.chipBtn,...(manualKey===it.key?{background:it.color,color:"white",borderColor:it.color}:{})}}>
                      {it.emoji} {it.label}
                    </button>
                  ))}
                </div>
                <input type="datetime-local" value={manualTime} onChange={e=>setManualTime(e.target.value)} style={st.input}/>
                {manualKey&&itemByKey(manualKey).hasMl&&(
                  <select value={manualMl??""} onChange={e=>setManualMl(Number(e.target.value))} style={st.input}>
                    <option value="">ml選択</option>
                    {ML_OPTIONS.map(m=><option key={m} value={m}>{m}ml</option>)}
                  </select>
                )}
                {manualKey&&itemByKey(manualKey).hasValue&&(
                  <input type="number" placeholder={itemByKey(manualKey).placeholder}
                    value={manualVal} onChange={e=>setManualVal(e.target.value)} style={st.input}/>
                )}
                <input placeholder="メモ（任意）" value={manualNote} onChange={e=>setManualNote(e.target.value)} style={st.input}/>
                <button onClick={submitManual} style={st.submitBtn} disabled={!manualKey||!manualTime}>記録する</button>
              </div>
            )}
            <button onClick={()=>setSleepManual(v=>!v)} style={{...st.manualToggle,fontSize:wide?16:13,padding:wide?14:10}}>✏️ 睡眠を時刻指定で記録</button>
            {sleepManual&&(
              <div style={st.manualCard}>
                <label style={st.inputLabel}>😴 寝た時刻（必須）</label>
                <input type="datetime-local" value={smStart} onChange={e=>setSmStart(e.target.value)} style={st.input}/>
                <label style={st.inputLabel}>☀️ 起きた時刻（任意）</label>
                <input type="datetime-local" value={smEnd} onChange={e=>setSmEnd(e.target.value)} style={st.input}/>
                <button onClick={addSleepManual} style={{...st.submitBtn,background:SLEEP_C}} disabled={!smStart}>記録する</button>
              </div>
            )}
            {/* 直近の記録 */}
            <div style={{background:"white",border:"1px solid #EBEBEB",borderRadius:wide?20:14,padding:wide?20:12,display:"flex",flexDirection:"column",gap:wide?10:6}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:wide?18:13,fontWeight:800,color:"#555"}}>🕒 直近の記録</span>
                <button onClick={()=>setView("history")} style={{...st.memoEditBtn,fontSize:wide?14:11}}>すべて見る →</button>
              </div>
              {allItems.length===0&&<span style={{fontSize:13,color:"#AAA"}}>まだ記録がありません</span>}
              {allItems.slice(0,wide?8:4).map(item=>{
                const isS=item.itemType==="sleep_start", isE=item.itemType==="sleep_end";
                const it=isS?{emoji:"😴",label:"就寝",color:SLEEP_C}:isE?{emoji:"☀️",label:"起床",color:"#F4A261"}:itemByKey(item.key);
                return (
                  <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:wide?"8px 10px":"6px 8px",borderLeft:`4px solid ${it.color}`,background:"#F4FAFE",borderRadius:8}}>
                    <span style={{fontSize:wide?22:16}}>{it.emoji}</span>
                    <span style={{fontSize:wide?16:13,fontWeight:700,flex:1}}>
                      {it.label}
                      {item.ml!=null&&<span style={st.badge}>{item.ml}ml</span>}
                      {item.value!=null&&<span style={st.badge}>{item.value}{item.unit}</span>}
                      {isE&&<span style={st.badge}>{fmtDur(item.duration)}</span>}
                    </span>
                    <OpTag label={item.operator}/>
                    <span style={{fontSize:wide?15:12,color:"#888",whiteSpace:"nowrap",minWidth:wide?60:44,textAlign:"right"}}>{fmtDate(item.timestamp)==="今日"?fmt(item.timestamp):`${fmtDate(item.timestamp)} ${fmt(item.timestamp)}`}</span>
                    <button onClick={()=>isS?delSleep(item.sessionId):(!isE&&delRecord(item.id))} style={{...st.delBtn,visibility:isE?"hidden":"visible"}}>×</button>
                  </div>
                );
              })}
            </div>
          </div>
          </div>
        )}
        {view==="history"&&(
          <div style={st.section}>
            <h2 style={st.secTitle}>記録履歴</h2>
            {Object.keys(groupedAll).length===0&&<p style={st.empty}>まだ記録がありません</p>}
            <div style={wide?{columns:2,columnGap:20}:st.section}>
            {Object.entries(groupedAll).map(([dk,items])=>(
              <div key={dk} style={st.dateGroup}>
                <div style={st.dateLabel}>{fmtDate(items[0].timestamp)}</div>
                {items.map(item=>{
                  if(item.itemType==="record"){
                    const it=itemByKey(item.key);
                    return (
                      <div key={item.id} style={{...st.row,borderLeftColor:it.color}}>
                        <span style={{fontSize:18}}>{it.emoji}</span>
                        <div style={st.rowInfo}>
                          <span style={{fontSize:wide?17:14,fontWeight:700}}>{it.label}
                            {item.ml!=null&&<span style={st.badge}>{item.ml}ml</span>}
                            {item.value!=null&&<span style={st.badge}>{item.value}{item.unit}</span>}
                          </span>
                          {item.note&&<span style={{fontSize:12,color:"#888"}}>{item.note}</span>}
                        </div>
                        <div style={st.rowRight}>
                          <span style={st.rowTime}>{fmt(item.timestamp)}</span>
                          <OpTag label={item.operator}/>
                        </div>
                        <button onClick={()=>delRecord(item.id)} style={st.delBtn}>×</button>
                      </div>
                    );
                  }
                  if(item.itemType==="sleep_start"){
                    return(
                      <div key={item.id} style={{...st.row,borderLeftColor:SLEEP_C}}>
                        <span style={{fontSize:18}}>😴</span>
                        <div style={st.rowInfo}><span style={{fontSize:wide?17:14,fontWeight:700,color:SLEEP_C}}>就寝</span></div>
                        <div style={st.rowRight}>
                          <span style={st.rowTime}>{fmt(item.timestamp)}</span>
                          <OpTag label={item.operator}/>
                        </div>
                        <button onClick={()=>delSleep(item.sessionId)} style={st.delBtn}>×</button>
                      </div>
                    );
                  }
                  if(item.itemType==="sleep_end"){
                    return(
                      <div key={item.id} style={{...st.row,borderLeftColor:"#F4A261"}}>
                        <span style={{fontSize:18}}>☀️</span>
                        <div style={st.rowInfo}>
                          <span style={{fontSize:wide?17:14,fontWeight:700,color:"#B07020"}}>起床</span>
                          <span style={{fontSize:12,color:"#888"}}>睡眠 {fmtDur(item.duration)}</span>
                        </div>
                        <div style={st.rowRight}>
                          <span style={st.rowTime}>{fmt(item.timestamp)}</span>
                        </div>
                        <span style={{width:24}}/>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            ))}
            </div>
          </div>
        )}
        {view==="summary"&&(
          <SummaryView records={records} sleep={sleep} todayCount={todayCount} todaySleepMs={todaySleepMs} fmtDur={fmtDur} SLEEP_C={SLEEP_C} wide={wide} zoom={zoom} />
        )}
        {view==="settings"&&(
          <div style={wide?{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,alignItems:"start"}:st.section}>
          <div style={st.section}>
            <div style={st.settingRow}>
              <h3 style={{margin:0,fontSize:wide?16:13,color:"#555"}}>この端末の操作者</h3>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span style={{fontSize:16,fontWeight:700,color:curOp.color}}>{curOp.emoji} {curOp.label}</span>
                <button onClick={()=>setOpModal(true)} style={st.memoEditBtn}>切り替え</button>
              </div>
            </div>

            <h2 style={st.secTitle}>リマインダー設定</h2>
            <p style={{fontSize:13,color:"#888",margin:0}}>最後の記録から指定時間後にアラート</p>
            {ALL_ITEMS.slice(0,7).map(it=>{
              const hrs = Math.round((reminders[it.key]||0)/60*10)/10;
              return (
                <div key={it.key} style={st.settingRow}>
                  <span style={{fontSize:wide?17:14,fontWeight:700}}>{it.emoji} {it.label}</span>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <input type="range" min={0} max={12} step={0.5} value={hrs}
                      onChange={e=>setRem(prev=>({...prev,[it.key]:Math.round(Number(e.target.value)*60)}))}
                      style={{flex:1,accentColor:it.color}}/>
                    <span style={{fontSize:wide?16:13,fontWeight:700,minWidth:wide?64:44,textAlign:"right"}}>
                      {hrs===0?"OFF":`${hrs}時間`}
                    </span>
                  </div>
                </div>
              );
            })}
            <div style={{background:"#F0EEFF",border:"1px solid #7C6FCD",borderRadius:12,padding:14,display:"flex",flexDirection:"column",gap:8}}>
              <h3 style={{margin:0,fontSize:13,color:"#7C6FCD"}}>プッシュ通知</h3>
              <p style={{margin:0,fontSize:12,color:"#888"}}>タップして通知を許可するとリマインダーがスマホに届きます</p>
              <button
                onClick={()=>subscribePush().then(()=>alert("通知を許可しました！")).catch(()=>alert("通知の許可に失敗しました"))}
                style={{background:"#7C6FCD",color:"white",border:"none",borderRadius:10,padding:12,fontSize:14,fontWeight:700,cursor:"pointer"}}>
                🔔 通知を許可する
              </button>
            </div>
          </div>
          <div style={st.section}>
            {/* 操作ログ */}
            <div style={st.settingRow}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <h3 style={{margin:0,fontSize:wide?16:13,color:"#555"}}>📋 操作ログ（誰が・いつ・何を）</h3>
                <button onClick={async()=>{ setLogsLoading(true); setLogs(await loadLogs()); setLogsLoading(false); }} style={st.memoEditBtn}>更新</button>
              </div>
              {logsLoading&&<p style={{margin:0,fontSize:12,color:"#AAA"}}>読み込み中...</p>}
              {!logsLoading&&logs.length===0&&<p style={{margin:0,fontSize:12,color:"#AAA"}}>まだ操作ログはありません</p>}
              <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:wide?520:360,overflowY:"auto"}}>
                {logs.map(l=>{
                  const o=opByLabel(l.operator);
                  const d=l.detail||{};
                  let desc=ACTION_LABELS[l.action]||l.action;
                  if(l.action==="add_record"||l.action==="delete_record"){
                    desc+=`：${d.label||""}`;
                    if(d.ml!=null) desc+=` ${d.ml}ml`;
                    if(d.value!=null) desc+=` ${d.value}${d.unit||""}`;
                    if(d.note) desc+=`（${d.note}）`;
                    if(d.timestamp) desc+=` @${fmt(d.timestamp)}`;
                  }
                  if(l.action==="sleep_end"&&d.duration_min!=null) desc+=`（${fmtDur(d.duration_min*60000)}）`;
                  if(l.action==="memo_update") desc+=`：${(d.content||"").slice(0,30)}${(d.content||"").length>30?"…":""}`;
                  if(l.action==="operator_change") desc+=`：${d.from}→${d.to}`;
                  const isDel=l.action.startsWith("delete")||l.action.startsWith("clear");
                  return (
                    <div key={l.id} style={{...st.logRow,borderLeftColor:isDel?"#E74C3C":o.color}}>
                      <span style={{...st.opTag,background:o.color,flexShrink:0}}>{o.emoji} {o.label}</span>
                      <span style={{flex:1,fontSize:wide?15:12,color:isDel?"#C0392B":"#333"}}>{desc}</span>
                      <span style={{fontSize:wide?13:10,color:"#999",whiteSpace:"nowrap"}}>{fmtDateTime(l.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={st.dangerZone}>
              <h3 style={{margin:0,fontSize:13,color:"#C0392B"}}>データ管理</h3>
              <button onClick={clearRecords} style={st.dangerBtn}>🗑️ 記録をすべて削除</button>
              <button onClick={clearSleep} style={st.dangerBtn}>🗑️ 睡眠記録を削除</button>
            </div>
          </div>
          </div>
        )}
      </main>

      {showOpModal&&(
        <div style={{...st.overlay,alignItems:"center",background:"rgba(0,0,0,.35)"}} onClick={()=>{ if(operator) setOpModal(false); }}>
          <div style={st.opPopup} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:16,fontWeight:700,textAlign:"center"}}>{operator?"操作者を切り替え":"あなたはどなたですか？"}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {OPERATORS.map(o=>(
                <button key={o.label} onClick={()=>chooseOperator(o.label)}
                  style={{...st.opChoice,borderColor:o.color,background:operator===o.label?o.color:"white",color:operator===o.label?"white":o.color}}>
                  <span style={{fontSize:36}}>{o.emoji}</span>
                  <span style={{fontSize:14,fontWeight:700}}>{o.label}</span>
                </button>
              ))}
            </div>
            {operator&&<p style={{margin:0,fontSize:11,color:"#AAA",textAlign:"center"}}>外側をクリックで閉じる</p>}
          </div>
        </div>
      )}
      {mlModal&&(
        <div style={ovl} onClick={()=>setMlModal(null)}>
          <div style={mdl} onClick={e=>e.stopPropagation()}>
            <div style={mTitle}>{mlModal.emoji} {mlModal.label}</div>
            {wide?(
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
                {ML_OPTIONS.map(ml=><button key={ml} onClick={()=>confirmMl(ml)} style={{border:`2px solid ${mlModal.color}`,background:"white",color:mlModal.color,borderRadius:14,padding:"16px 4px",fontSize:20,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>{ml}<span style={{fontSize:12,fontWeight:600}}>ml</span></button>)}
              </div>
            ):(
              <div style={st.mlList}>
                {ML_OPTIONS.map(ml=><button key={ml} onClick={()=>confirmMl(ml)} style={st.mlItem}>{ml}ml</button>)}
              </div>
            )}
            <button onClick={()=>setMlModal(null)} style={st.cancelBtn}>キャンセル</button>
          </div>
        </div>
      )}
      {valModal&&(
        <div style={ovl} onClick={()=>setValModal(null)}>
          <div style={{...mdl,gap:14}} onClick={e=>e.stopPropagation()}>
            <div style={mTitle}>{valModal.emoji} {valModal.label} ({valModal.unit})</div>
            <input type="number" step="0.1" placeholder={valModal.placeholder}
              value={valInput} onChange={e=>setValInput(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter") confirmVal(); }}
              style={{...st.input,fontSize:wide?40:20,padding:wide?"18px":"10px 12px",textAlign:"center",fontWeight:700,borderColor:valModal.color}} autoFocus/>
            <button onClick={confirmVal} style={{...st.submitBtn,fontSize:wide?20:15,padding:wide?16:12,background:valModal.color}} disabled={!valInput}>記録する</button>
            <button onClick={()=>setValModal(null)} style={st.cancelBtn}>キャンセル</button>
          </div>
        </div>
      )}
      {otherModal&&(
        <div style={ovl} onClick={()=>setOtherModal(false)}>
          <div style={{...mdl,gap:14}} onClick={e=>e.stopPropagation()}>
            <div style={mTitle}>••• その他</div>
            <input placeholder="内容を入力（例：散歩、泣いた...）"
              value={otherText} onChange={e=>setOtherText(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"&&otherText.trim()){ addRecord("other",{note:otherText.trim()}); setOtherModal(false); setOtherText(""); } }}
              style={{...st.input,fontSize:wide?22:16,padding:wide?"16px":"10px 12px"}} autoFocus/>
            <button onClick={()=>{ if(!otherText.trim()) return; addRecord("other",{note:otherText.trim()}); setOtherModal(false); setOtherText(""); }}
              style={{...st.submitBtn,fontSize:wide?20:15,padding:wide?16:12}} disabled={!otherText.trim()}>記録する</button>
            <button onClick={()=>setOtherModal(false)} style={st.cancelBtn}>キャンセル</button>
          </div>
        </div>
      )}
    </div>
  );
}

const st = {
  app:      { minHeight:"100vh", background:"#F4FAFE", fontFamily:"'Zen Maru Gothic','Hiragino Maru Gothic ProN','Hiragino Sans','Noto Sans JP',sans-serif", color:"#3A4A55" },
  alertBar: { background:"#FFF1C9", padding:"8px 16px", display:"flex", gap:12, flexWrap:"wrap", fontSize:13 },
  alertItem:{ fontWeight:700, color:"#8A6D1F" },
  header:   { background:"linear-gradient(90deg,#7EC8F0,#A6DCF5)", position:"sticky", top:0, zIndex:20, boxShadow:"0 2px 10px rgba(100,170,220,.25)" },
  headerIn: { maxWidth:520, margin:"0 auto", padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" },
  logo:     { fontSize:18, fontWeight:900, color:"white", textShadow:"0 1px 2px rgba(0,0,0,.1)" },
  nav:      { display:"flex", gap:4, background:"rgba(255,255,255,.35)", borderRadius:24, padding:3 },
  navBtn:   { padding:"6px 12px", border:"none", background:"transparent", borderRadius:20, fontSize:13, cursor:"pointer", color:"white", fontWeight:700, whiteSpace:"nowrap" },
  navActive:{ background:"white", color:"#3E8FC7" },
  opBtn:    { padding:"5px 10px", border:"2px solid", borderRadius:20, fontSize:11, fontWeight:900, cursor:"pointer", whiteSpace:"nowrap", boxShadow:"0 2px 6px rgba(0,0,0,.08)" },
  opTag:    { fontSize:10, fontWeight:800, color:"white", borderRadius:10, padding:"1px 8px", whiteSpace:"nowrap", display:"inline-block" },
  opChoice: { border:"3px solid", borderRadius:18, padding:"16px 8px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:6 },
  opPopup:  { background:"white", borderRadius:24, width:"calc(100% - 32px)", maxWidth:380, padding:22, display:"flex", flexDirection:"column", gap:14, boxShadow:"0 16px 48px rgba(60,100,130,.25)" },
  main:     { maxWidth:520, margin:"0 auto", padding:14 },
  section:  { display:"flex", flexDirection:"column", gap:14 },
  memoCard: { background:"#FFF6D9", border:"none", borderRadius:24, padding:16, display:"flex", flexDirection:"column", gap:10, boxShadow:"0 4px 14px rgba(230,180,80,.18)" },
  whoGrid:   { display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 },
  whoBtn:    { border:"3px solid", borderRadius:14, padding:"12px 6px", fontWeight:900, cursor:"pointer" },
  memoEditBtn:{ background:"white", border:"2px solid #EADFC4", borderRadius:20, padding:"5px 14px", fontSize:12, fontWeight:800, cursor:"pointer", color:"#8A6D1F" },
  sleepCard:{ border:"none", borderRadius:24, padding:16, display:"flex", flexDirection:"column", gap:12, boxShadow:"0 4px 14px rgba(124,111,205,.18)" },
  sleepTop: { display:"flex", alignItems:"center", gap:12 },
  sleepBtns:{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 },
  sleepBtn: { border:"none", borderRadius:16, padding:14, fontSize:15, fontWeight:900, cursor:"pointer", color:"white", transition:"all .15s", boxShadow:"0 3px 0 rgba(0,0,0,.12)" },
  catBlock: { background:"white", border:"none", borderRadius:20, padding:12, display:"flex", flexDirection:"column", gap:8, boxShadow:"0 4px 14px rgba(120,170,210,.14)" },
  catLabel: { fontSize:12, fontWeight:900, letterSpacing:.5 },
  catGrid:  { display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 },
  itemBtn:  { border:"none", borderRadius:16, padding:"12px 4px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:2, transition:"all .15s" },
  manualToggle:{ background:"white", border:"2px dashed #EBD3CA", borderRadius:16, padding:12, fontSize:14, color:"#8FA0AC", cursor:"pointer", width:"100%", fontWeight:700 },
  manualCard:  { background:"white", border:"none", borderRadius:20, padding:16, display:"flex", flexDirection:"column", gap:10, boxShadow:"0 4px 14px rgba(120,170,210,.14)" },
  chipBtn:     { padding:"7px 12px", border:"2px solid #EEE0DA", borderRadius:20, background:"white", cursor:"pointer", fontSize:13, fontWeight:800, color:"#3A4A55" },
  input:       { width:"100%", padding:"12px 14px", border:"2px solid #EEE0DA", borderRadius:14, fontSize:15, outline:"none", boxSizing:"border-box", background:"#FBFDFF", color:"#3A4A55" },
  inputLabel:  { fontSize:13, fontWeight:800, color:"#7A8A95" },
  submitBtn:   { background:"#3E8FC7", color:"white", border:"none", borderRadius:14, padding:14, fontSize:16, fontWeight:900, cursor:"pointer", boxShadow:"0 3px 0 rgba(0,0,0,.12)" },
  secTitle:  { fontSize:20, fontWeight:900, margin:0, color:"#3E8FC7" },
  empty:     { color:"#AEBBC5", textAlign:"center", padding:32 },
  dateGroup: { display:"flex", flexDirection:"column", gap:6, breakInside:"avoid", marginBottom:14 },
  homeWide:  { display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:24, alignItems:"start", width:"100%" },
  dateLabel: { fontSize:13, fontWeight:900, color:"#3E8FC7", letterSpacing:.5, padding:"4px 10px", background:"#E3F2FC", borderRadius:20, alignSelf:"flex-start" },
  row:       { background:"white", border:"none", borderLeft:"5px solid", borderRadius:14, padding:"11px 14px", display:"flex", alignItems:"center", gap:10, boxShadow:"0 2px 8px rgba(120,170,210,.12)" },
  rowInfo:   { flex:1, display:"flex", flexDirection:"column", gap:2 },
  rowRight:  { display:"flex", flexDirection:"column", alignItems:"flex-end", gap:3 },
  rowTime:   { fontSize:13, color:"#8FA0AC", whiteSpace:"nowrap", fontWeight:700 },
  delBtn:    { background:"none", border:"none", color:"#C5D3DC", cursor:"pointer", fontSize:18, padding:4 },
  badge:     { marginLeft:6, fontSize:12, background:"#E3F2FC", borderRadius:8, padding:"1px 8px", color:"#2B6FA3", fontWeight:800 },
  settingRow:{ background:"white", border:"none", borderRadius:20, padding:16, display:"flex", flexDirection:"column", gap:10, boxShadow:"0 4px 14px rgba(120,170,210,.14)" },
  logRow:    { background:"#F4FAFE", borderLeft:"4px solid", borderRadius:8, padding:"7px 10px", display:"flex", alignItems:"center", gap:8 },
  dangerZone:{ background:"#FFF0F0", border:"none", borderRadius:20, padding:16, display:"flex", flexDirection:"column", gap:8 },
  dangerBtn: { background:"white", border:"2px solid #E74C3C", borderRadius:12, padding:12, color:"#E74C3C", fontSize:14, fontWeight:800, cursor:"pointer" },
  overlay:   { position:"fixed", inset:0, background:"rgba(40,70,90,.45)", zIndex:50, display:"flex", alignItems:"flex-end", justifyContent:"center", backdropFilter:"blur(2px)" },
  modal:     { background:"white", borderRadius:"24px 24px 0 0", width:"100%", maxWidth:520, maxHeight:"70vh", overflow:"auto", padding:20, display:"flex", flexDirection:"column", gap:0 },
  modalTitle:{ fontSize:20, fontWeight:900, textAlign:"center", padding:"8px 0 14px", color:"#3E8FC7" },
  mlList:    { display:"flex", flexDirection:"column" },
  mlItem:    { padding:"15px 20px", border:"none", borderBottom:"1px solid #F5EDEA", background:"white", cursor:"pointer", fontSize:17, fontWeight:700, textAlign:"left", color:"#3A4A55" },
  cancelBtn: { marginTop:8, padding:14, border:"none", background:"#EAF3F9", borderRadius:14, fontSize:15, fontWeight:800, cursor:"pointer", color:"#7A8A95" },
};

const SUMMARY_TABS = [
  { key:"nursing", label:"食事" }, { key:"sleep", label:"睡眠" },
  { key:"excretion", label:"排泄" }, { key:"health", label:"体温" }, { key:"all", label:"すべて" },
];
const TAB_ITEMS = {
  nursing:   [{ key:"breastfeed", label:"母乳", color:"#F08080", dot:true },{ key:"milk", label:"ミルク", color:"#F4A261", dot:true },{ key:"pumped", label:"搾母乳", color:"#FFB347", dot:true }],
  sleep:     [{ key:"__sleep__", label:"睡眠", color:"#7C6FCD", bar:true }],
  excretion: [{ key:"pee", label:"おしっこ", color:"#4ECDC4", dot:true },{ key:"poo", label:"うんち", color:"#C8A870", dot:true },{ key:"pee_poo", label:"両方", color:"#88B8A8", dot:true }],
  health:    [{ key:"temp", label:"体温", color:"#FF8C8C" }],
  all:       [{ key:"breastfeed", color:"#F08080", dot:true },{ key:"milk", color:"#F4A261", dot:true },{ key:"pee", color:"#4ECDC4", dot:true },{ key:"poo", color:"#C8A870", dot:true },{ key:"__sleep__", color:"#7C6FCD", bar:true }],
};

function get7Days() {
  const days=[];
  for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); days.push(d); }
  return days;
}

// ─── 比較（前週比・前月比） ───────────────────────────────────────
function sumRange(records, sleep, from, to) {
  const inR = (ts) => ts>=from && ts<to;
  const rs = records.filter(r=>inR(r.timestamp));
  const milk = rs.filter(r=>r.key==="milk").reduce((a,r)=>a+(r.ml||0),0);
  const pumped = rs.filter(r=>r.key==="pumped").reduce((a,r)=>a+(r.ml||0),0);
  const bf = rs.filter(r=>r.key==="breastfeed").length;
  const pee = rs.filter(r=>r.key==="pee"||r.key==="pee_poo").length;
  const poo = rs.filter(r=>r.key==="poo"||r.key==="pee_poo").length;
  const slpMin = Math.round(sleep.filter(s=>s.end&&inR(s.start)).reduce((a,s)=>a+(s.end-s.start),0)/60000);
  const temps = rs.filter(r=>r.key==="temp").map(r=>parseFloat(r.value)).filter(v=>!isNaN(v));
  const temp = temps.length? Math.round(temps.reduce((a,v)=>a+v,0)/temps.length*10)/10 : null;
  const days = Math.max(1, Math.round((to-from)/86400000));
  return { milk, pumped, bf, pee, poo, slpMin, temp, days };
}
function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x.getTime(); }
function getComparePeriods() {
  const now = Date.now();
  const tomorrow = startOfDay(now) + 86400000;
  const weekFrom = tomorrow - 7*86400000;
  const prevWeekFrom = weekFrom - 7*86400000;
  const d = new Date();
  const monthFrom = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const elapsed = tomorrow - monthFrom;
  const prevMonthFrom = new Date(d.getFullYear(), d.getMonth()-1, 1).getTime();
  return {
    week:  { cur:[weekFrom, tomorrow], prev:[prevWeekFrom, weekFrom], label:"直近7日", prevLabel:"その前の7日" },
    month: { cur:[monthFrom, tomorrow], prev:[prevMonthFrom, prevMonthFrom+elapsed], label:"今月（1日〜今日）", prevLabel:"前月の同じ日数" },
  };
}
const COMPARE_METRICS = {
  nursing:   [{k:"milk",label:"ミルク",unit:"ml",color:"#F4A261"},{k:"pumped",label:"搾母乳",unit:"ml",color:"#FFB347"},{k:"bf",label:"母乳",unit:"回",color:"#F08080"}],
  sleep:     [{k:"slpMin",label:"睡眠",unit:"分",color:"#7C6FCD",dur:true}],
  excretion: [{k:"pee",label:"おしっこ",unit:"回",color:"#4ECDC4"},{k:"poo",label:"うんち",unit:"回",color:"#C8A870"}],
  health:    [{k:"temp",label:"平均体温",unit:"℃",color:"#FF8C8C",avg:true}],
  all:       [{k:"milk",label:"ミルク",unit:"ml",color:"#F4A261"},{k:"bf",label:"母乳",unit:"回",color:"#F08080"},{k:"pee",label:"おしっこ",unit:"回",color:"#4ECDC4"},{k:"poo",label:"うんち",unit:"回",color:"#C8A870"},{k:"slpMin",label:"睡眠",unit:"分",color:"#7C6FCD",dur:true}],
};
function fmtMetric(v, m, fmtDur) {
  if(v==null) return "–";
  if(m.dur) return fmtDur(v*60000);
  return `${v}${m.unit}`;
}
function CompareCard({ title, sub, cur, prev, metrics, fmtDur, wide }) {
  return (
    <div style={{background:"white",border:"1px solid #E8E8E8",borderRadius:12,overflow:"hidden"}}>
      <div style={{padding:wide?"12px 16px":"10px 12px",borderBottom:"1px solid #F0F0F0",display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
        <span style={{fontSize:wide?16:14,fontWeight:700}}>{title}</span>
        <span style={{fontSize:wide?12:10,color:"#999"}}>{sub}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 1fr 1fr",fontSize:wide?11:10,color:"#999",padding:wide?"6px 16px":"6px 12px",borderBottom:"1px solid #F5F5F5"}}>
        <span/><span style={{textAlign:"right"}}>今回</span><span style={{textAlign:"right"}}>前回</span><span style={{textAlign:"right"}}>増減</span>
      </div>
      {metrics.map(m=>{
        const c=cur[m.k], p=prev[m.k];
        const perDayC = m.avg||c==null ? c : Math.round(c/cur.days*10)/10;
        const perDayP = m.avg||p==null ? p : Math.round(p/prev.days*10)/10;
        let diffTxt="–", diffColor="#999";
        if(c!=null&&p!=null){
          if(m.avg){ const d=Math.round((c-p)*10)/10; diffTxt=(d>0?"+":"")+d+m.unit; diffColor=d>0?"#E74C3C":d<0?"#2E86DE":"#999"; }
          else if(p>0){ const pct=Math.round((c-p)/p*100); diffTxt=(pct>0?"+":"")+pct+"%"; diffColor=pct>0?"#27AE60":pct<0?"#E67E22":"#999"; }
          else if(c>0){ diffTxt="NEW"; diffColor="#27AE60"; }
        }
        return (
          <div key={m.k} style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 1fr 1fr",alignItems:"center",padding:wide?"10px 16px":"8px 12px",borderBottom:"1px solid #F5F5F5",fontSize:wide?15:13}}>
            <span style={{fontWeight:600,color:m.color}}>{m.label}</span>
            <span style={{textAlign:"right",fontWeight:700}}>{fmtMetric(c,m,fmtDur)}{!m.avg&&c!=null&&<span style={{display:"block",fontSize:wide?10:9,color:"#AAA",fontWeight:400}}>1日 {fmtMetric(perDayC,m,fmtDur)}</span>}</span>
            <span style={{textAlign:"right",color:"#777"}}>{fmtMetric(p,m,fmtDur)}{!m.avg&&p!=null&&<span style={{display:"block",fontSize:wide?10:9,color:"#BBB"}}>1日 {fmtMetric(perDayP,m,fmtDur)}</span>}</span>
            <span style={{textAlign:"right",fontWeight:700,color:diffColor}}>{diffTxt}</span>
          </div>
        );
      })}
    </div>
  );
}

function SummaryView({ records, sleep, todayCount, todaySleepMs, fmtDur, SLEEP_C, wide, zoom=1 }) {
  const [tab, setTab] = useState("nursing");
  const [mode, setMode] = useState("time");
  const days = get7Days();
  const today = new Date().toDateString();
  const vw = typeof window!=="undefined" ? window.innerWidth/zoom : 520;
  const LEFT_W = wide?36:28;
  const COL_W = wide ? Math.max(44, Math.floor((vw - 40 - 28 - LEFT_W - 2) / 7)) : 44;
  const HOUR_H = wide?28:18, BAR_MAX_H = wide?180:100;
  const periods = getComparePeriods();
  const weekCur = sumRange(records, sleep, ...periods.week.cur);
  const weekPrev = sumRange(records, sleep, ...periods.week.prev);
  const monthCur = sumRange(records, sleep, ...periods.month.cur);
  const monthPrev = sumRange(records, sleep, ...periods.month.prev);
  const cmpMetrics = COMPARE_METRICS[tab]||[];

  const amountData = days.map(d=>{
    const ds=d.toDateString(), label=`${d.getMonth()+1}/${d.getDate()}`, isToday=ds===today;
    const milk=records.filter(r=>r.key==="milk"&&new Date(r.timestamp).toDateString()===ds).reduce((a,r)=>a+(r.ml||0),0);
    const bf=records.filter(r=>r.key==="breastfeed"&&new Date(r.timestamp).toDateString()===ds).length;
    const pee=records.filter(r=>(r.key==="pee"||r.key==="pee_poo")&&new Date(r.timestamp).toDateString()===ds).length;
    const poo=records.filter(r=>(r.key==="poo"||r.key==="pee_poo")&&new Date(r.timestamp).toDateString()===ds).length;
    const slpMin=Math.round(sleep.filter(s=>s.end&&new Date(s.start).toDateString()===ds).reduce((a,s)=>a+(s.end-s.start),0)/60000);
    const temps=records.filter(r=>r.key==="temp"&&new Date(r.timestamp).toDateString()===ds);
    const temp=temps.length?parseFloat(temps[temps.length-1].value):null;
    return{label,isToday,milk,bf,pee,poo,slpMin,temp};
  });

  const maxVal=(()=>{
    if(tab==="nursing") return Math.max(...amountData.map(d=>Math.max(d.milk,d.bf*30)),1);
    if(tab==="excretion") return Math.max(...amountData.map(d=>Math.max(d.pee,d.poo)),1);
    if(tab==="sleep") return Math.max(...amountData.map(d=>d.slpMin),1);
    return 1;
  })();

  const timeToY=(ts)=>{ const d=new Date(ts); return(d.getHours()+d.getMinutes()/60)*HOUR_H; };
  const tabItemDefs=TAB_ITEMS[tab]||[];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:0,background:"transparent",minHeight:"100%"}}>
      <div style={{display:"flex",overflowX:"auto",borderBottom:"1px solid #E0E0E0",background:"white",position:"sticky",top:wide?92:58,zIndex:10,borderRadius:wide?12:0}}>
        {SUMMARY_TABS.map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)} style={{flex:"0 0 auto",padding:"10px 16px",border:"none",
            borderBottom:tab===t.key?"2.5px solid #4A90D9":"2.5px solid transparent",background:"transparent",
            cursor:"pointer",fontSize:wide?18:14,padding:wide?"14px 28px":"10px 16px",color:tab===t.key?"#3E8FC7":"#666",fontWeight:tab===t.key?700:400,fontFamily:"inherit"}}>{t.label}</button>
        ))}
      </div>
      <div style={{display:"flex",margin:"10px 14px 6px",background:"#F0F0F0",borderRadius:20,padding:3}}>
        {[["time","時間"],["amount","量"]].map(([k,l])=>(
          <button key={k} onClick={()=>setMode(k)} style={{flex:1,padding:"6px 0",border:"none",borderRadius:17,
            background:mode===k?"#3E8FC7":"transparent",color:mode===k?"white":"#555",
            fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
        ))}
      </div>
      {mode==="time"&&(
        <div style={{margin:"0 14px",background:"white",border:"1px solid #E8E8E8",borderRadius:12,overflow:"hidden"}}>
          <div style={{display:"flex",borderBottom:"1px solid #E8E8E8"}}>
            <div style={{width:LEFT_W,flexShrink:0}}/>
            {days.map((d,i)=>{ const isT=d.toDateString()===today; return(
              <div key={i} style={{width:COL_W,flexShrink:0,textAlign:"center",padding:"6px 0",fontSize:11,
                fontWeight:isT?700:400,color:isT?"#E03030":"#666",background:isT?"#FFF0F0":"transparent"}}>
                {d.getMonth()+1}/{d.getDate()}
              </div>
            );})}
          </div>
          <div style={{overflowY:"auto",maxHeight:420}}>
            <div style={{display:"flex"}}>
              <div style={{width:LEFT_W,flexShrink:0,position:"relative",height:24*HOUR_H}}>
                {[0,3,6,9,12,15,18,21].map(h=><div key={h} style={{position:"absolute",top:h*HOUR_H-7,right:2,fontSize:9,color:"#AAA"}}>{h}</div>)}
              </div>
              <div style={{flex:1,position:"relative",height:24*HOUR_H}}>
                {days.map((d,i)=>d.toDateString()===today&&<div key={i} style={{position:"absolute",left:i*COL_W,top:0,width:COL_W,height:24*HOUR_H,background:"rgba(255,180,180,.12)"}}/>)}
                {[0,3,6,9,12,15,18,21,24].map(h=><div key={h} style={{position:"absolute",left:0,right:0,top:h*HOUR_H,borderTop:h%6===0?"1px solid #DDD":"1px dashed #EBEBEB"}}/>)}
                {days.map((_,i)=><div key={i} style={{position:"absolute",left:i*COL_W,top:0,bottom:0,borderLeft:"1px solid #EBEBEB"}}/>)}
                {(tab==="sleep"||tab==="all")&&sleep.filter(s=>s.end).map(s=>{
                  const di=days.findIndex(d=>d.toDateString()===new Date(s.start).toDateString());
                  if(di<0) return null;
                  const y1=timeToY(s.start),y2=timeToY(s.end),h=Math.max(y2-y1,4);
                  return <div key={s.id} style={{position:"absolute",left:di*COL_W+4,width:COL_W-8,top:y1,height:h,background:"rgba(124,111,205,.35)",border:"1.5px solid #7C6FCD",borderRadius:4}}/>;
                })}
                {tabItemDefs.filter(ti=>ti.dot).map(ti=>records.filter(r=>r.key===ti.key).map(r=>{
                  const di=days.findIndex(d=>d.toDateString()===new Date(r.timestamp).toDateString());
                  if(di<0) return null;
                  return <div key={r.id} style={{position:"absolute",left:di*COL_W+COL_W/2-5,top:timeToY(r.timestamp)-5,width:10,height:10,borderRadius:"50%",background:ti.color,border:"1.5px solid white",boxShadow:"0 1px 3px rgba(0,0,0,.2)"}}/>;
                }))}
              </div>
            </div>
          </div>
          <div style={{padding:"8px 10px",borderTop:"1px solid #F0F0F0",display:"flex",gap:10,flexWrap:"wrap"}}>
            {tabItemDefs.map(ti=>(
              <span key={ti.key} style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#555"}}>
                <span style={{width:10,height:10,borderRadius:ti.bar?"2px":"50%",background:ti.color,display:"inline-block"}}/>{ti.label||""}
              </span>
            ))}
          </div>
        </div>
      )}
      {mode==="amount"&&(
        <div style={{margin:"0 14px",display:"flex",flexDirection:"column",gap:12}}>
          <div style={{background:"white",border:"1px solid #E8E8E8",borderRadius:12,overflow:"hidden"}}>
            <div style={{display:"flex",borderBottom:"1px solid #E8E8E8"}}>
              <div style={{width:LEFT_W,flexShrink:0}}/>
              {days.map((d,i)=>{ const isT=d.toDateString()===today; return(
                <div key={i} style={{width:COL_W,flexShrink:0,textAlign:"center",padding:"6px 2px",fontSize:11,fontWeight:isT?700:400,color:isT?"#E03030":"#666"}}>{d.getMonth()+1}/{d.getDate()}</div>
              );})}
            </div>
            <div style={{display:"flex",alignItems:"flex-end",height:BAR_MAX_H+16,padding:"8px 0 4px",borderBottom:"1px solid #F0F0F0"}}>
              <div style={{width:LEFT_W,flexShrink:0}}/>
              {amountData.map((d,i)=>{
                const vals=tab==="nursing"?[{v:d.milk,c:"#F4A261"},{v:d.bf*30,c:"#F08080"}]
                  :tab==="excretion"?[{v:d.pee,c:"#4ECDC4"},{v:d.poo,c:"#C8A870"}]
                  :tab==="sleep"?[{v:d.slpMin,c:SLEEP_C}]
                  :tab==="health"?[{v:d.temp||0,c:"#FF8C8C"}]
                  :[{v:d.milk,c:"#F4A261"}];
                return(
                  <div key={i} style={{width:COL_W,flexShrink:0,display:"flex",justifyContent:"center",alignItems:"flex-end",gap:2,height:BAR_MAX_H}}>
                    {vals.map((v,j)=>{ const h=Math.round((v.v/maxVal)*BAR_MAX_H);
                      return h>0?<div key={j} style={{width:12,height:h,background:v.c,borderRadius:"3px 3px 0 0",opacity:d.isToday?1:.75}}/>
                        :<div key={j} style={{width:12,height:2,background:"#EEE",borderRadius:2}}/>;
                    })}
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex"}}>
              <div style={{width:LEFT_W,flexShrink:0}}/>
              {amountData.map((d,i)=>{
                const val=tab==="nursing"?`${d.milk}ml`:tab==="excretion"?`${d.pee}回`:tab==="sleep"?`${d.slpMin}m`:tab==="health"?(d.temp?`${d.temp}℃`:"–"):`${d.milk}`;
                return <div key={i} style={{width:COL_W,flexShrink:0,textAlign:"center",fontSize:9,color:d.isToday?"#E03030":"#888",padding:"4px 0",fontWeight:d.isToday?700:400}}>{val}</div>;
              })}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,paddingBottom:8}}>
            {[
              {label:"ミルク",value:`${amountData[6].milk}ml`,color:"#F4A261"},
              {label:"母乳",value:`${amountData[6].bf}回`,color:"#F08080"},
              {label:"おしっこ",value:`${amountData[6].pee}回`,color:"#4ECDC4"},
              {label:"うんち",value:`${amountData[6].poo}回`,color:"#C8A870"},
              {label:"睡眠",value:todaySleepMs>0?fmtDur(todaySleepMs):"0分",color:SLEEP_C},
              {label:"体温",value:amountData[6].temp?`${amountData[6].temp}℃`:"–",color:"#FF8C8C"},
            ].map(({label,value,color})=>(
              <div key={label} style={{border:`2px solid ${color}`,borderRadius:12,padding:"10px 8px",display:"flex",flexDirection:"column",alignItems:"center",gap:2,background:"white"}}>
                <span style={{fontSize:wide?13:10,color:"#777"}}>{label}</span>
                <span style={{fontSize:wide?24:17,fontWeight:700,color}}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {cmpMetrics.length>0&&(
        <div style={{margin:"16px 14px 20px",display:"grid",gridTemplateColumns:wide?"1fr 1fr":"1fr",gap:14}}>
          <CompareCard title="📅 前週比" sub={`${periods.week.label} vs ${periods.week.prevLabel}`} cur={weekCur} prev={weekPrev} metrics={cmpMetrics} fmtDur={fmtDur} wide={wide}/>
          <CompareCard title="🗓 前月比" sub={`${periods.month.label} vs ${periods.month.prevLabel}`} cur={monthCur} prev={monthPrev} metrics={cmpMetrics} fmtDur={fmtDur} wide={wide}/>
        </div>
      )}
    </div>
  );
}
