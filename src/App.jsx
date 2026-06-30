// src/App.jsx
// Vite + React 독립 앱. Tailwind + lucide-react 필요.
import { useState, useEffect, useMemo, useRef } from "react";
import { Plus, Trash2, Save, FolderOpen, Server, Database, Network, X, Copy, Upload, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";

const HOURS_PER_MONTH = 730;
const LS_PRICES = "awsEstimator.priceData";
const LS_ESTIMATE_PREFIX = "awsEstimator.estimate.";

const FALLBACK = {
  _meta: { region: "ap-northeast-2", source: "내장 폴백(근사)", updated: null },
  ec2: {
    "m7i.large": { hourly: 0.1134, vcpu: 2, memory: "8 GiB" },
    "m7i.xlarge": { hourly: 0.2268, vcpu: 4, memory: "16 GiB" },
    "m7i.2xlarge": { hourly: 0.4536, vcpu: 8, memory: "32 GiB" },
    "c7i.large": { hourly: 0.1003, vcpu: 2, memory: "4 GiB" },
    "c7i.xlarge": { hourly: 0.2006, vcpu: 4, memory: "8 GiB" },
    "c7i.2xlarge": { hourly: 0.4012, vcpu: 8, memory: "16 GiB" },
    "r7i.large": { hourly: 0.1487, vcpu: 2, memory: "16 GiB" },
    "r7i.xlarge": { hourly: 0.2974, vcpu: 4, memory: "32 GiB" },
    "m7g.large": { hourly: 0.0908, vcpu: 2, memory: "8 GiB" },
    "c7g.large": { hourly: 0.0803, vcpu: 2, memory: "4 GiB" },
    "r7g.large": { hourly: 0.119, vcpu: 2, memory: "16 GiB" },
  },
  rds: {
    "MySQL|db.m7g.large": { engine: "MySQL", instanceType: "db.m7g.large", hourly: 0.198, vcpu: 2, memory: "8 GiB" },
    "MySQL|db.m7g.xlarge": { engine: "MySQL", instanceType: "db.m7g.xlarge", hourly: 0.396, vcpu: 4, memory: "16 GiB" },
    "MySQL|db.r7g.large": { engine: "MySQL", instanceType: "db.r7g.large", hourly: 0.276, vcpu: 2, memory: "16 GiB" },
    "PostgreSQL|db.m7g.large": { engine: "PostgreSQL", instanceType: "db.m7g.large", hourly: 0.211, vcpu: 2, memory: "8 GiB" },
    "PostgreSQL|db.m7g.xlarge": { engine: "PostgreSQL", instanceType: "db.m7g.xlarge", hourly: 0.422, vcpu: 4, memory: "16 GiB" },
    "PostgreSQL|db.r7g.large": { engine: "PostgreSQL", instanceType: "db.r7g.large", hourly: 0.29, vcpu: 2, memory: "16 GiB" },
  },
  ebs: { gp3: { perGbMonth: 0.0912 } },
};

const STATIC_RATES = { rdsStorageGp2: 0.131, egress: 0.126 };

const SERVICE_DEFS = {
  ec2: { name: "EC2 (컴퓨팅)", icon: Server, color: "#f59e0b" },
  rds: { name: "RDS (데이터베이스)", icon: Database, color: "#3b82f6" },
  transfer: { name: "데이터 전송", icon: Network, color: "#ef4444" },
};

function memGiB(memStr) {
  if (!memStr) return null;
  const m = String(memStr).match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

function specOptions(catalog) {
  const vcpus = new Set(), mems = new Set();
  for (const v of Object.values(catalog)) {
    if (v.vcpu) vcpus.add(v.vcpu);
    const g = memGiB(v.memory);
    if (g) mems.add(g);
  }
  return { vcpus: [...vcpus].sort((a, b) => a - b), mems: [...mems].sort((a, b) => a - b) };
}

function makeItem(type) {
  const id = Date.now() + Math.random();
  switch (type) {
    case "ec2": return { id, type, vcpu: 0, mem: 0, instanceType: "", count: 1, hours: HOURS_PER_MONTH, ebsGb: 30 };
    case "rds": return { id, type, engine: "MySQL", vcpu: 0, mem: 0, rdsKey: "", multiAz: false, storageGb: 100, hours: HOURS_PER_MONTH };
    case "transfer": return { id, type, egressGb: 100 };
    default: return { id, type };
  }
}

function itemCost(item, prices) {
  const gp3 = prices.ebs?.gp3?.perGbMonth ?? FALLBACK.ebs.gp3.perGbMonth;
  switch (item.type) {
    case "ec2": {
      const rate = prices.ec2?.[item.instanceType]?.hourly || 0;
      return rate * item.hours * item.count + item.ebsGb * gp3 * item.count;
    }
    case "rds": {
      const rate = prices.rds?.[item.rdsKey]?.hourly || 0;
      const az = item.multiAz ? 2 : 1;
      return rate * item.hours * az + item.storageGb * STATIC_RATES.rdsStorageGp2 * az;
    }
    case "transfer": return Math.max(0, item.egressGb - 100) * STATIC_RATES.egress;
    default: return 0;
  }
}

const fmt = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function validatePrices(obj) {
  if (!obj || typeof obj !== "object") return "JSON 객체가 아닙니다.";
  if (!obj.ec2 || typeof obj.ec2 !== "object") return "ec2 항목이 없습니다.";
  if (!obj.rds || typeof obj.rds !== "object") return "rds 항목이 없습니다.";
  if (Object.keys(obj.ec2).length === 0 && Object.keys(obj.rds).length === 0) return "ec2/rds 모두 비어 있습니다.";
  return null;
}

function matchInstances(catalog, { vcpu, mem, engine }) {
  return Object.entries(catalog)
    .filter(([, v]) => {
      if (engine && v.engine !== engine) return false;
      if (vcpu && v.vcpu !== vcpu) return false;
      if (mem && memGiB(v.memory) !== mem) return false;
      return true;
    })
    .sort((a, b) => a[1].hourly - b[1].hourly);
}

const ls = {
  get(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
  del(key) { try { localStorage.removeItem(key); } catch {} },
  keys(prefix) { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) out.push(k); } return out; },
};

function NumberField({ label, value, onChange, step = 1, min = 0, suffix }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <div className="flex items-center gap-1">
        <input type="number" value={value} min={min} step={step}
          onChange={(e) => onChange(Math.max(min, parseFloat(e.target.value) || 0))}
          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none" />
        {suffix && <span className="text-xs text-slate-400 whitespace-nowrap">{suffix}</span>}
      </div>
    </label>
  );
}

function SpecSelect({ label, value, options, onChange, fmtOpt }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <select value={value} onChange={(e) => onChange(parseFloat(e.target.value))}
        className="rounded-lg border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none">
        <option value={0}>전체</option>
        {options.map((o) => <option key={o} value={o}>{fmtOpt(o)}</option>)}
      </select>
    </label>
  );
}

function CardHeader({ def, onRemove }) {
  const Icon = def.icon;
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: def.color + "22" }}>
          <Icon size={16} style={{ color: def.color }} />
        </span>
        <span className="font-medium text-slate-700">{def.name}</span>
      </div>
      <button onClick={onRemove} className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={16} /></button>
    </div>
  );
}

function CardFooter({ spec, cost }) {
  return (
    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
      <span className="text-xs text-slate-400">{spec || ""}</span>
      <span className="text-sm text-slate-500">월 예상: <span className="font-semibold text-slate-800">{fmt(cost)}</span></span>
    </div>
  );
}

function Ec2Card({ item, prices, onChange, onRemove }) {
  const set = (patch) => onChange({ ...item, ...patch });
  const opts = useMemo(() => specOptions(prices.ec2 || {}), [prices.ec2]);
  const matches = useMemo(() => matchInstances(prices.ec2 || {}, { vcpu: item.vcpu, mem: item.mem }), [prices.ec2, item.vcpu, item.mem]);

  useEffect(() => {
    if (matches.length && !matches.find(([k]) => k === item.instanceType)) set({ instanceType: matches[0][0] });
    if (!matches.length && item.instanceType) set({ instanceType: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.vcpu, item.mem, prices.ec2]);

  const sel = prices.ec2?.[item.instanceType];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <CardHeader def={SERVICE_DEFS.ec2} onRemove={onRemove} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SpecSelect label="vCPU" value={item.vcpu} options={opts.vcpus} onChange={(v) => set({ vcpu: v })} fmtOpt={(o) => `${o} vCPU`} />
        <SpecSelect label="메모리" value={item.mem} options={opts.mems} onChange={(v) => set({ mem: v })} fmtOpt={(o) => `${o} GiB`} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-500">인스턴스 ({matches.length}개)</span>
          <select value={item.instanceType} onChange={(e) => set({ instanceType: e.target.value })}
            className="rounded-lg border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none">
            {matches.length === 0 && <option value="">조건 맞는 인스턴스 없음</option>}
            {matches.map(([k, v]) => <option key={k} value={k}>{k} — ${v.hourly}/hr</option>)}
          </select>
        </label>
        <NumberField label="인스턴스 수" value={item.count} onChange={(v) => set({ count: v })} />
        <NumberField label="월 가동 시간" value={item.hours} onChange={(v) => set({ hours: v })} suffix="시간" />
        <NumberField label="EBS gp3" value={item.ebsGb} onChange={(v) => set({ ebsGb: v })} suffix="GB" />
      </div>
      <CardFooter spec={sel ? `${sel.vcpu} vCPU · ${sel.memory}` : null} cost={itemCost(item, prices)} />
    </div>
  );
}

function RdsCard({ item, prices, onChange, onRemove }) {
  const set = (patch) => onChange({ ...item, ...patch });
  const engines = useMemo(() => [...new Set(Object.values(prices.rds || {}).map((v) => v.engine))].sort(), [prices.rds]);
  const opts = useMemo(() => specOptions(prices.rds || {}), [prices.rds]);
  const matches = useMemo(() => matchInstances(prices.rds || {}, { vcpu: item.vcpu, mem: item.mem, engine: item.engine }), [prices.rds, item.vcpu, item.mem, item.engine]);

  useEffect(() => {
    if (matches.length && !matches.find(([k]) => k === item.rdsKey)) set({ rdsKey: matches[0][0] });
    if (!matches.length && item.rdsKey) set({ rdsKey: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.vcpu, item.mem, item.engine, prices.rds]);

  const sel = prices.rds?.[item.rdsKey];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <CardHeader def={SERVICE_DEFS.rds} onRemove={onRemove} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-500">엔진</span>
          <select value={item.engine} onChange={(e) => set({ engine: e.target.value })}
            className="rounded-lg border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none">
            {engines.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
        <SpecSelect label="vCPU" value={item.vcpu} options={opts.vcpus} onChange={(v) => set({ vcpu: v })} fmtOpt={(o) => `${o} vCPU`} />
        <SpecSelect label="메모리" value={item.mem} options={opts.mems} onChange={(v) => set({ mem: v })} fmtOpt={(o) => `${o} GiB`} />
        <label className="flex flex-col gap-1 text-sm sm:col-span-3">
          <span className="text-slate-500">인스턴스 ({matches.length}개)</span>
          <select value={item.rdsKey} onChange={(e) => set({ rdsKey: e.target.value })}
            className="rounded-lg border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none">
            {matches.length === 0 && <option value="">조건 맞는 인스턴스 없음</option>}
            {matches.map(([k, v]) => <option key={k} value={k}>{v.instanceType} — ${v.hourly}/hr</option>)}
          </select>
        </label>
        <NumberField label="월 가동 시간" value={item.hours} onChange={(v) => set({ hours: v })} suffix="시간" />
        <NumberField label="스토리지(gp2)" value={item.storageGb} onChange={(v) => set({ storageGb: v })} suffix="GB" />
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input type="checkbox" checked={item.multiAz} onChange={(e) => set({ multiAz: e.target.checked })} className="h-4 w-4" />
          <span className="text-slate-600">Multi-AZ (비용 2배)</span>
        </label>
      </div>
      <CardFooter spec={sel ? `${sel.vcpu} vCPU · ${sel.memory}` : null} cost={itemCost(item, prices)} />
    </div>
  );
}

function TransferCard({ item, onChange, onRemove }) {
  const set = (patch) => onChange({ ...item, ...patch });
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <CardHeader def={SERVICE_DEFS.transfer} onRemove={onRemove} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <NumberField label="아웃바운드 (첫 100GB 무료)" value={item.egressGb} onChange={(v) => set({ egressGb: v })} suffix="GB" />
      </div>
      <CardFooter cost={itemCost(item, {})} />
    </div>
  );
}

function PriceDataModal({ onApply, onClose }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  const tryApply = (raw) => {
    try {
      const obj = JSON.parse(raw);
      const err = validatePrices(obj);
      if (err) { setError(err); return; }
      onApply(obj);
    } catch (e) { setError("JSON 파싱 실패: " + e.message); }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const raw = await file.text();
    setText(raw.length > 5000 ? raw.slice(0, 5000) + "\n... (생략)" : raw);
    tryApply(raw);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">가격 데이터 불러오기</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <p className="mb-3 text-sm text-slate-500">
          앱은 시작 시 <code className="rounded bg-slate-100 px-1">prices.json</code>을 자동 로드합니다.
          수동 교체가 필요하면 파일을 올리거나 붙여넣으세요.
        </p>
        <button onClick={() => fileRef.current?.click()}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 py-4 text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600">
          <Upload size={18} /> prices.json 파일 선택
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} className="hidden" />
        <div className="mb-2 text-xs text-slate-400">또는 JSON 붙여넣기</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)}
          placeholder='{ "ec2": { ... }, "rds": { ... }, "ebs": { "gp3": {...} } }'
          className="h-40 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs focus:border-blue-500 focus:outline-none" />
        {error && (
          <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 p-2 text-xs text-red-600">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">취소</button>
          <button onClick={() => tryApply(text)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">적용</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [prices, setPrices] = useState(FALLBACK);
  const [priceSource, setPriceSource] = useState("loading");
  const [items, setItems] = useState([makeItem("ec2")]);
  const [estimateName, setEstimateName] = useState("");
  const [saved, setSaved] = useState([]);
  const [showSaved, setShowSaved] = useState(false);
  const [showPrices, setShowPrices] = useState(false);
  const [toast, setToast] = useState("");

  const total = useMemo(() => items.reduce((s, it) => s + itemCost(it, prices), 0), [items, prices]);

  useEffect(() => {
    (async () => {
      try {
        // import.meta.env.BASE_URL: dev = "/", prod (GitHub Pages) = "/aws-estimator/"
        const res = await fetch(import.meta.env.BASE_URL + "prices.json", { cache: "no-store" });
        if (res.ok) {
          const obj = await res.json();
          if (!validatePrices(obj)) { setPrices(obj); setPriceSource("remote"); return; }
        }
      } catch {}
      const cached = ls.get(LS_PRICES);
      if (cached && !validatePrices(cached)) { setPrices(cached); setPriceSource("custom"); return; }
      setPriceSource("fallback");
    })();

    const recs = [];
    for (const k of ls.keys(LS_ESTIMATE_PREFIX)) { const r = ls.get(k); if (r) recs.push(r); }
    recs.sort((a, b) => b.savedAt - a.savedAt);
    setSaved(recs);
  }, []);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  const applyPrices = (obj) => {
    setPrices(obj);
    setPriceSource("custom");
    ls.set(LS_PRICES, obj);
    setShowPrices(false);
    flash(`가격 적용됨 · EC2 ${Object.keys(obj.ec2||{}).length} / RDS ${Object.keys(obj.rds||{}).length}`);
  };

  const saveEstimate = () => {
    const name = estimateName.trim();
    if (!name) { flash("견적 이름을 입력해 주세요"); return; }
    const record = { name, items, savedAt: Date.now() };
    ls.set(LS_ESTIMATE_PREFIX + name, record);
    setSaved((prev) => [record, ...prev.filter((s) => s.name !== name)]);
    flash("저장되었습니다");
  };

  const loadEstimate = (rec) => {
    setItems(rec.items.map((it) => ({ ...it, id: Date.now() + Math.random() })));
    setEstimateName(rec.name);
    setShowSaved(false);
    flash(`"${rec.name}" 불러옴`);
  };

  const deleteEstimate = (name) => {
    ls.del(LS_ESTIMATE_PREFIX + name);
    setSaved((p) => p.filter((s) => s.name !== name));
  };

  const addItem = (type) => setItems((prev) => [...prev, makeItem(type)]);
  const updateItem = (it) => setItems((prev) => prev.map((p) => (p.id === it.id ? it : p)));
  const removeItem = (id) => setItems((prev) => prev.filter((p) => p.id !== id));

  const updatedLabel = prices._meta?.updated
    ? new Date(prices._meta.updated).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" })
    : null;

  const banner = {
    remote: { ok: true, text: <>공용 단가 로드됨 ({Object.keys(prices.ec2).length} EC2 / {Object.keys(prices.rds).length} RDS){updatedLabel && ` · ${updatedLabel}`}</> },
    custom: { ok: true, text: <>수동 적용 단가 ({Object.keys(prices.ec2).length} EC2 / {Object.keys(prices.rds).length} RDS)</> },
    fallback: { ok: false, text: <>내장 폴백 단가 — prices.json 로드 실패</> },
    loading: { ok: true, text: <>가격 데이터 로딩 중…</> },
  }[priceSource];

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-slate-800">AWS 비용 견적 계산기</h1>
          <p className="mt-1 text-sm text-slate-500">서울 리전 · 7세대+ · vCPU/메모리 스펙 검색</p>
        </header>

        <div className={`mb-4 flex items-center justify-between rounded-xl border p-3 ${banner.ok ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
          <div className="flex items-center gap-2 text-sm">
            {banner.ok ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertCircle size={16} className="text-amber-600" />}
            <span className={banner.ok ? "text-emerald-700" : "text-amber-700"}>{banner.text}</span>
          </div>
          <button onClick={() => setShowPrices(true)} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
            <RefreshCw size={14} /> 가격 교체
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="flex flex-1 flex-col gap-1 text-sm" style={{ minWidth: 200 }}>
            <span className="text-slate-500">견적 이름</span>
            <input value={estimateName} onChange={(e) => setEstimateName(e.target.value)} placeholder="예: 스타트업 MVP"
              className="rounded-lg border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none" />
          </label>
          <button onClick={saveEstimate} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Save size={15} /> 저장
          </button>
          <button onClick={() => setShowSaved(true)} className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <FolderOpen size={15} /> 불러오기 ({saved.length})
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {Object.entries(SERVICE_DEFS).map(([type, def]) => {
            const Icon = def.icon;
            return (
              <button key={type} onClick={() => addItem(type)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50">
                <Plus size={14} /> <Icon size={14} style={{ color: def.color }} /> {def.name}
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          {items.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
              위 버튼으로 서비스를 추가해 견적을 시작하세요.
            </div>
          )}
          {items.map((it) => {
            if (it.type === "ec2") return <Ec2Card key={it.id} item={it} prices={prices} onChange={updateItem} onRemove={() => removeItem(it.id)} />;
            if (it.type === "rds") return <RdsCard key={it.id} item={it} prices={prices} onChange={updateItem} onRemove={() => removeItem(it.id)} />;
            return <TransferCard key={it.id} item={it} prices={prices} onChange={updateItem} onRemove={() => removeItem(it.id)} />;
          })}
        </div>

        <div className="sticky bottom-4 mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-slate-500">월 예상 합계 (서울)</span>
              <div className="text-3xl font-bold text-slate-800">{fmt(total)}</div>
            </div>
            <div className="text-right text-sm text-slate-500">
              <div>연간 약</div>
              <div className="text-lg font-semibold text-slate-700">{fmt(total * 12)}</div>
            </div>
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-slate-400">
          EC2·RDS·EBS gp3 단가는 prices.json(AWS Price List Bulk API, 서울)에서 로드됩니다.
          데이터 전송·RDS 스토리지는 내장 근사 단가입니다.
          무료 티어·예약·Savings Plan·세금 미반영. 예산 확정은 calculator.aws에서 확인하세요.
        </p>
      </div>

      {showPrices && <PriceDataModal onApply={applyPrices} onClose={() => setShowPrices(false)} />}

      {showSaved && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowSaved(false)}>
          <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">저장된 견적</h2>
              <button onClick={() => setShowSaved(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
            </div>
            {saved.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">저장된 견적이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {saved.map((rec) => (
                  <div key={rec.name} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-700">{rec.name}</div>
                      <div className="text-xs text-slate-400">{rec.items.length}개 항목 · {fmt(rec.items.reduce((s, it) => s + itemCost(it, prices), 0))}/월</div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => loadEstimate(rec)} className="rounded-md p-1.5 text-blue-600 hover:bg-blue-50" title="불러오기"><Copy size={16} /></button>
                      <button onClick={() => deleteEstimate(rec.name)} className="rounded-md p-1.5 text-red-500 hover:bg-red-50" title="삭제"><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>
      )}
    </div>
  );
}
