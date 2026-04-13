import { useState, useEffect, useCallback, useRef } from "react";

// ─── Supabase ────────────────────────────────────────────────────
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || "";

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
  return data.map(s => ({ id: s.id, start: s.start_time, end: s.end_time || null }));
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
    }),
  });
}

async function deleteSleepDb(id) {
  await sbFetch(`sleep_sessions?id=eq.${id}`, { method: "DELETE" });
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

// ─── Storage keys ───────────────────────────────────────────────
const SK = "bt_records";
const SLEEP_SK = "bt_sleep";
const REM_SK = "bt_reminders";

const CATS = {
  nursing: {
    label: "食事", color: "#E8845C",
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
    label: "排泄", color: "#4ECDC4",
    items: [
      { key: "pee",     label: "おしっこ", emoji: "💧", color: "#4ECDC4" },
      { key: "poo",     label: "うんち",   emoji: "💩", color: "#C8A870" },
      { key: "pee_poo", label: "両方",     emoji: "💧💩", color: "#88B8A8" },
    ],
  },
  health: {
    label: "健康", color: "#FF8C8C",
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
    label: "活動", color: "#7C6FCD",
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

function useTick(active) {
  const [,set]=useState(0);
  useEffect(()=>{ if(!active) return; const id=setInterval(()=>set(t=>t+1),15000); return()=>clearInterval(id); },[active]);
}

export default function BabyTracker() {
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

  const isSleeping = sleep.find(s=>!s.end)||null;
  useTick(!!isSleeping);

  // 初回ロード：Supabaseから取得
  useEffect(()=>{
    (async()=>{
      setLoading(true);
      const [recs, slps] = await Promise.all([loadRecords(), loadSleep()]);
      if(recs.length > 0) {
        setRecords(recs.map(r=>({
          id: r.id, key: r.key, timestamp: r.timestamp,
          label: r.label, ml: r.ml, value: r.value, unit: r.unit, note: r.note,
        })));
      } else {
        // Supabaseが空ならlocalStorageから移行
        const local = JSON.parse(localStorage.getItem(SK)||"[]");
        setRecords(local);
      }
      if(slps.length > 0) {
        setSleep(slps);
      } else {
        const local = JSON.parse(localStorage.getItem(SLEEP_SK)||"[]");
        setSleep(local);
      }
      setLoading(false);
    })();
  },[]);

  // 30秒ごとに最新データを取得（他デバイスの更新を反映）
  useEffect(()=>{
    const id = setInterval(async()=>{
      const [recs, slps] = await Promise.all([loadRecords(), loadSleep()]);
      if(recs.length >= 0) {
        setRecords(recs.map(r=>({
          id: r.id, key: r.key, timestamp: r.timestamp,
          label: r.label, ml: r.ml, value: r.value, unit: r.unit, note: r.note,
        })));
      }
      if(slps.length >= 0) setSleep(slps);
    }, 30000);
    return()=>clearInterval(id);
  },[]);

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

  const addRecord = useCallback(async(key,extra={},ts=Date.now())=>{
    const rec = {id:Date.now()+Math.random(),key,timestamp:ts,...extra};
    setRecords(prev=>[rec,...prev].slice(0,1000));
    flash(key);
    const it = itemByKey(key);
    const recWithLabel = { ...rec, label: it.label };
    // Supabase & GAS に並行送信
    await upsertRecord(recWithLabel);
    gasPost({ action:"add", record:{ ...recWithLabel, unit:extra.unit||"" } });
  },[]);

  const delRecord = async(id) => {
    setRecords(prev=>prev.filter(r=>r.id!==id));
    await deleteRecord(id);
    gasPost({ action:"delete", id });
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
    const s = {id:Date.now(),start:ts,end:null};
    setSleep(prev=>[s,...prev]);
    flash("sleep");
    await upsertSleep(s);
    gasPost({ action:"addSleep", session:s });
  };
  const endSleep = async(ts=Date.now()) => {
    if(!isSleeping) return;
    const updated = {...isSleeping, end:ts};
    setSleep(prev=>prev.map(s=>!s.end?updated:s));
    flash("wake");
    await upsertSleep(updated);
    gasPost({ action:"updateSleep", session:updated });
  };
  const delSleep = async(id) => {
    setSleep(prev=>prev.filter(s=>s.id!==id));
    await deleteSleepDb(id);
    gasPost({ action:"deleteSleep", id });
  };
  const addSleepManual=async()=>{
    if(!smStart) return;
    const s = {id:Date.now(),start:new Date(smStart).getTime(),end:smEnd?new Date(smEnd).getTime():null};
    setSleep(prev=>[s,...prev]);
    setSleepManual(false); setSmStart(""); setSmEnd("");
    await upsertSleep(s);
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

  const todayCount = (key)=>records.filter(r=>r.key===key&&new Date(r.timestamp).toDateString()===todayStr()).length;
  const lastOf     = (key)=>records.find(r=>r.key===key);
  const todaySleepMs=sleep.filter(s=>s.end&&new Date(s.start).toDateString()===todayStr()).reduce((a,s)=>a+(s.end-s.start),0);

  const allItems=[
    ...records.map(r=>({...r,itemType:"record"})),
    ...sleep.flatMap(s=>{
      const arr=[{id:s.id+"_s",itemType:"sleep_start",timestamp:s.start,sessionId:s.id}];
      if(s.end) arr.push({id:s.id+"_e",itemType:"sleep_end",timestamp:s.end,sessionId:s.id,duration:s.end-s.start});
      return arr;
    }),
  ].sort((a,b)=>b.timestamp-a.timestamp);
  const groupedAll=groupByDate(allItems);
  const SLEEP_C="#7C6FCD";

  if(loading) return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#FAFAF8",flexDirection:"column",gap:12}}>
      <div style={{fontSize:40}}>🍼</div>
      <div style={{fontSize:16,color:"#888"}}>データを読み込み中...</div>
    </div>
  );

  return (
    <div style={st.app}>
      {Object.keys(alerts).length>0&&(
        <div style={st.alertBar}>
          {Object.entries(alerts).map(([k,m])=>{
            const it=itemByKey(k);
            return <span key={k} style={st.alertItem}>{it.emoji} {it.label}から{m}分</span>;
          })}
        </div>
      )}
      <header style={st.header}>
        <div style={st.headerIn}>
          <span style={st.logo}>🍼 ふくちゃん</span>
          <nav style={st.nav}>
            {[["home","記録"],["history","履歴"],["summary","グラフ"],["settings","設定"]].map(([v,l])=>(
              <button key={v} onClick={()=>setView(v)} style={{...st.navBtn,...(view===v?st.navActive:{})}}>{l}</button>
            ))}
          </nav>
        </div>
      </header>
      <main style={st.main}>
        {view==="home"&&(
          <div style={st.section}>
            <div style={{...st.sleepCard,borderColor:SLEEP_C,background:"#F0EEFF"}}>
              <div style={st.sleepTop}>
                <span style={{fontSize:30}}>{isSleeping?"😴":"☀️"}</span>
                <div style={{display:"flex",flexDirection:"column",gap:3}}>
                  <span style={{fontSize:13,fontWeight:600,color:"#555"}}>睡眠</span>
                  <span style={{fontSize:15,fontWeight:700,color:isSleeping?SLEEP_C:"#444"}}>
                    {isSleeping?`就寝中 · ${fmtDur(Date.now()-isSleeping.start)} 経過`:`今日 ${todaySleepMs>0?fmtDur(todaySleepMs):"0分"}`}
                  </span>
                </div>
              </div>
              <div style={st.sleepBtns}>
                <button onClick={()=>startSleep()} disabled={!!isSleeping}
                  style={{...st.sleepBtn,background:!isSleeping?SLEEP_C:"#CCC",opacity:isSleeping?.45:1}}>😴 寝た</button>
                <button onClick={()=>endSleep()} disabled={!isSleeping}
                  style={{...st.sleepBtn,background:isSleeping?"#F4A261":"#CCC",opacity:!isSleeping?.45:1}}>☀️ 起きた</button>
              </div>
            </div>
            {Object.entries(CATS).map(([catKey,cat])=>(
              <div key={catKey} style={st.catBlock}>
                <div style={{...st.catLabel,color:cat.color}}>{cat.label}</div>
                <div style={st.catGrid}>
                  {cat.items.map((item)=>{
                    const done=justDone===item.key;
                    return (
                      <button key={item.key} onClick={()=>handleTap(item)}
                        style={{...st.itemBtn,background:done?item.color:"white",borderColor:item.color,
                          color:done?"white":item.color,transform:done?"scale(0.94)":"scale(1)"}}>
                        <span style={{fontSize:22}}>{item.emoji}</span>
                        <span style={{fontSize:11,fontWeight:600,marginTop:2}}>{item.label}</span>
                        {(item.key==="milk"||item.key==="pumped")&&<span style={{fontSize:9,opacity:.6}}>ml選択</span>}
                        {item.key!=="milk"&&item.key!=="pumped"&&<span style={{fontSize:9,opacity:.5}}>{timeSince(lastOf(item.key)?.timestamp||0)||"未記録"}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <button onClick={()=>setManualOpen(v=>!v)} style={st.manualToggle}>✏️ 時刻を指定して記録</button>
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
            <button onClick={()=>setSleepManual(v=>!v)} style={st.manualToggle}>✏️ 睡眠を時刻指定で記録</button>
            {sleepManual&&(
              <div style={st.manualCard}>
                <label style={st.inputLabel}>😴 寝た時刻（必須）</label>
                <input type="datetime-local" value={smStart} onChange={e=>setSmStart(e.target.value)} style={st.input}/>
                <label style={st.inputLabel}>☀️ 起きた時刻（任意）</label>
                <input type="datetime-local" value={smEnd} onChange={e=>setSmEnd(e.target.value)} style={st.input}/>
                <button onClick={addSleepManual} style={{...st.submitBtn,background:SLEEP_C}} disabled={!smStart}>記録する</button>
              </div>
            )}
          </div>
        )}
        {view==="history"&&(
          <div style={st.section}>
            <h2 style={st.secTitle}>記録履歴</h2>
            {Object.keys(groupedAll).length===0&&<p style={st.empty}>まだ記録がありません</p>}
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
                          <span style={{fontSize:14,fontWeight:600}}>{it.label}
                            {item.ml!=null&&<span style={st.badge}>{item.ml}ml</span>}
                            {item.value!=null&&<span style={st.badge}>{item.value}{item.unit}</span>}
                          </span>
                          {item.note&&<span style={{fontSize:12,color:"#888"}}>{item.note}</span>}
                        </div>
                        <span style={st.rowTime}>{fmt(item.timestamp)}</span>
                        <button onClick={()=>delRecord(item.id)} style={st.delBtn}>×</button>
                      </div>
                    );
                  }
                  if(item.itemType==="sleep_start"){
                    return(
                      <div key={item.id} style={{...st.row,borderLeftColor:SLEEP_C}}>
                        <span style={{fontSize:18}}>😴</span>
                        <div style={st.rowInfo}><span style={{fontSize:14,fontWeight:600,color:SLEEP_C}}>就寝</span></div>
                        <span style={st.rowTime}>{fmt(item.timestamp)}</span>
                        <button onClick={()=>delSleep(item.sessionId)} style={st.delBtn}>×</button>
                      </div>
                    );
                  }
                  if(item.itemType==="sleep_end"){
                    return(
                      <div key={item.id} style={{...st.row,borderLeftColor:"#F4A261"}}>
                        <span style={{fontSize:18}}>☀️</span>
                        <div style={st.rowInfo}>
                          <span style={{fontSize:14,fontWeight:600,color:"#B07020"}}>起床</span>
                          <span style={{fontSize:12,color:"#888"}}>睡眠 {fmtDur(item.duration)}</span>
                        </div>
                        <span style={st.rowTime}>{fmt(item.timestamp)}</span>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            ))}
          </div>
        )}
        {view==="summary"&&(
          <SummaryView records={records} sleep={sleep} todayCount={todayCount} todaySleepMs={todaySleepMs} fmtDur={fmtDur} SLEEP_C={SLEEP_C} />
        )}
        {view==="settings"&&(
          <div style={st.section}>
            <h2 style={st.secTitle}>リマインダー設定</h2>
            <p style={{fontSize:13,color:"#888",margin:0}}>最後の記録から指定時間後にアラート</p>
            {ALL_ITEMS.slice(0,7).map(it=>{
              const hrs = Math.round((reminders[it.key]||0)/60*10)/10;
              return (
                <div key={it.key} style={st.settingRow}>
                  <span style={{fontSize:14,fontWeight:600}}>{it.emoji} {it.label}</span>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <input type="range" min={0} max={12} step={0.5} value={hrs}
                      onChange={e=>setRem(prev=>({...prev,[it.key]:Math.round(Number(e.target.value)*60)}))}
                      style={{flex:1,accentColor:it.color}}/>
                    <span style={{fontSize:13,fontWeight:700,minWidth:44,textAlign:"right"}}>
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
            <div style={st.dangerZone}>
              <h3 style={{margin:0,fontSize:13,color:"#C0392B"}}>データ管理</h3>
              <button onClick={()=>{ if(confirm("記録をすべて削除？")) setRecords([]); }} style={st.dangerBtn}>🗑️ 記録をすべて削除</button>
              <button onClick={()=>{ if(confirm("睡眠記録をすべて削除？")) setSleep([]); }} style={st.dangerBtn}>🗑️ 睡眠記録を削除</button>
            </div>
          </div>
        )}
      </main>
      {mlModal&&(
        <div style={st.overlay} onClick={()=>setMlModal(null)}>
          <div style={st.modal} onClick={e=>e.stopPropagation()}>
            <div style={st.modalTitle}>{mlModal.emoji} {mlModal.label}</div>
            <div style={st.mlList}>
              {ML_OPTIONS.map(ml=><button key={ml} onClick={()=>confirmMl(ml)} style={st.mlItem}>{ml}ml</button>)}
            </div>
            <button onClick={()=>setMlModal(null)} style={st.cancelBtn}>キャンセル</button>
          </div>
        </div>
      )}
      {valModal&&(
        <div style={st.overlay} onClick={()=>setValModal(null)}>
          <div style={{...st.modal,gap:12}} onClick={e=>e.stopPropagation()}>
            <div style={st.modalTitle}>{valModal.label} ({valModal.unit})</div>
            <input type="number" step="0.1" placeholder={valModal.placeholder}
              value={valInput} onChange={e=>setValInput(e.target.value)}
              style={{...st.input,fontSize:20,textAlign:"center"}} autoFocus/>
            <button onClick={confirmVal} style={st.submitBtn} disabled={!valInput}>記録する</button>
            <button onClick={()=>setValModal(null)} style={st.cancelBtn}>キャンセル</button>
          </div>
        </div>
      )}
      {otherModal&&(
        <div style={st.overlay} onClick={()=>setOtherModal(false)}>
          <div style={{...st.modal,gap:12}} onClick={e=>e.stopPropagation()}>
            <div style={st.modalTitle}>••• その他</div>
            <input placeholder="内容を入力（例：散歩、泣いた...）"
              value={otherText} onChange={e=>setOtherText(e.target.value)}
              style={{...st.input,fontSize:16}} autoFocus/>
            <button onClick={()=>{ if(!otherText.trim()) return; addRecord("other",{note:otherText.trim()}); setOtherModal(false); setOtherText(""); }}
              style={st.submitBtn} disabled={!otherText.trim()}>記録する</button>
            <button onClick={()=>setOtherModal(false)} style={st.cancelBtn}>キャンセル</button>
          </div>
        </div>
      )}
    </div>
  );
}

const st = {
  app:      { minHeight:"100vh", background:"#FAFAF8", fontFamily:"'Hiragino Sans','Noto Sans JP',sans-serif", color:"#2D2D2D" },
  alertBar: { background:"#FFF3CD", borderBottom:"1px solid #F0C040", padding:"8px 16px", display:"flex", gap:12, flexWrap:"wrap", fontSize:13 },
  alertItem:{ fontWeight:600, color:"#856404" },
  header:   { background:"white", borderBottom:"1px solid #EBEBEB", position:"sticky", top:0, zIndex:20 },
  headerIn: { maxWidth:520, margin:"0 auto", padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" },
  logo:     { fontSize:17, fontWeight:700 },
  nav:      { display:"flex", gap:2 },
  navBtn:   { padding:"5px 9px", border:"none", background:"transparent", borderRadius:20, fontSize:12, cursor:"pointer", color:"#888", fontWeight:500 },
  navActive:{ background:"#EEEAE4", color:"#2D2D2D" },
  main:     { maxWidth:520, margin:"0 auto", padding:14 },
  section:  { display:"flex", flexDirection:"column", gap:14 },
  sleepCard:{ border:"2px solid", borderRadius:16, padding:14, display:"flex", flexDirection:"column", gap:10 },
  sleepTop: { display:"flex", alignItems:"center", gap:12 },
  sleepBtns:{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 },
  sleepBtn: { border:"none", borderRadius:12, padding:12, fontSize:14, fontWeight:700, cursor:"pointer", color:"white", transition:"all .15s" },
  catBlock: { background:"white", border:"1px solid #EBEBEB", borderRadius:14, padding:12, display:"flex", flexDirection:"column", gap:8 },
  catLabel: { fontSize:12, fontWeight:700, letterSpacing:.5 },
  catGrid:  { display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 },
  itemBtn:  { border:"1.5px solid", borderRadius:12, padding:"10px 4px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:2, transition:"all .15s", background:"white" },
  manualToggle:{ background:"none", border:"1px dashed #CCC", borderRadius:10, padding:10, fontSize:13, color:"#888", cursor:"pointer", width:"100%" },
  manualCard:  { background:"white", border:"1px solid #E8E8E8", borderRadius:14, padding:14, display:"flex", flexDirection:"column", gap:10 },
  chipBtn:     { padding:"6px 10px", border:"1.5px solid #DDD", borderRadius:20, background:"white", cursor:"pointer", fontSize:12, fontWeight:600 },
  input:       { width:"100%", padding:"10px 12px", border:"1.5px solid #E0E0E0", borderRadius:10, fontSize:14, outline:"none", boxSizing:"border-box", fontFamily:"inherit" },
  inputLabel:  { fontSize:12, fontWeight:600, color:"#777" },
  submitBtn:   { background:"#2D2D2D", color:"white", border:"none", borderRadius:10, padding:12, fontSize:15, fontWeight:700, cursor:"pointer" },
  secTitle:  { fontSize:17, fontWeight:700, margin:0 },
  empty:     { color:"#AAA", textAlign:"center", padding:32 },
  dateGroup: { display:"flex", flexDirection:"column", gap:6 },
  dateLabel: { fontSize:11, fontWeight:700, color:"#AAA", letterSpacing:.5, padding:"2px 0" },
  row:       { background:"white", border:"1px solid #EEE", borderLeft:"4px solid", borderRadius:10, padding:"10px 12px", display:"flex", alignItems:"center", gap:10 },
  rowInfo:   { flex:1, display:"flex", flexDirection:"column", gap:2 },
  rowTime:   { fontSize:12, color:"#888", whiteSpace:"nowrap" },
  delBtn:    { background:"none", border:"none", color:"#CCC", cursor:"pointer", fontSize:16, padding:4 },
  badge:     { marginLeft:6, fontSize:11, background:"#F0F0F0", borderRadius:6, padding:"1px 6px", color:"#555" },
  settingRow:{ background:"white", border:"1px solid #EEE", borderRadius:12, padding:14, display:"flex", flexDirection:"column", gap:8 },
  dangerZone:{ background:"#FFF5F5", border:"1px solid #FFE0E0", borderRadius:12, padding:14, display:"flex", flexDirection:"column", gap:8 },
  dangerBtn: { background:"white", border:"1.5px solid #E74C3C", borderRadius:10, padding:10, color:"#E74C3C", fontSize:13, fontWeight:600, cursor:"pointer" },
  overlay:   { position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:50, display:"flex", alignItems:"flex-end", justifyContent:"center" },
  modal:     { background:"white", borderRadius:"20px 20px 0 0", width:"100%", maxWidth:520, maxHeight:"70vh", overflow:"auto", padding:20, display:"flex", flexDirection:"column", gap:0 },
  modalTitle:{ fontSize:18, fontWeight:700, textAlign:"center", padding:"8px 0 12px" },
  mlList:    { display:"flex", flexDirection:"column" },
  mlItem:    { padding:"14px 20px", border:"none", borderBottom:"1px solid #F0F0F0", background:"white", cursor:"pointer", fontSize:16, textAlign:"left" },
  cancelBtn: { marginTop:8, padding:14, border:"none", background:"#F5F5F5", borderRadius:12, fontSize:15, fontWeight:600, cursor:"pointer", color:"#555" },
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

function SummaryView({ records, sleep, todayCount, todaySleepMs, fmtDur, SLEEP_C }) {
  const [tab, setTab] = useState("nursing");
  const [mode, setMode] = useState("time");
  const days = get7Days();
  const today = new Date().toDateString();
  const HOUR_H=18, COL_W=44, LEFT_W=28, BAR_MAX_H=100;

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
    <div style={{display:"flex",flexDirection:"column",gap:0,background:"#FAFAF8",minHeight:"100%"}}>
      <div style={{display:"flex",overflowX:"auto",borderBottom:"1px solid #E0E0E0",background:"white",position:"sticky",top:52,zIndex:10}}>
        {SUMMARY_TABS.map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)} style={{flex:"0 0 auto",padding:"10px 16px",border:"none",
            borderBottom:tab===t.key?"2.5px solid #4A90D9":"2.5px solid transparent",background:"transparent",
            cursor:"pointer",fontSize:14,color:tab===t.key?"#4A90D9":"#666",fontWeight:tab===t.key?700:400,fontFamily:"inherit"}}>{t.label}</button>
        ))}
      </div>
      <div style={{display:"flex",margin:"10px 14px 6px",background:"#F0F0F0",borderRadius:20,padding:3}}>
        {[["time","時間"],["amount","量"]].map(([k,l])=>(
          <button key={k} onClick={()=>setMode(k)} style={{flex:1,padding:"6px 0",border:"none",borderRadius:17,
            background:mode===k?"#4A90D9":"transparent",color:mode===k?"white":"#555",
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
                <span style={{fontSize:10,color:"#777"}}>{label}</span>
                <span style={{fontSize:17,fontWeight:700,color}}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
