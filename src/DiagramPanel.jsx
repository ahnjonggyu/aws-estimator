// src/DiagramPanel.jsx
// 견적 items를 받아 네트워크 구성을 입히고 draw.io 다이어그램을 생성한다.
//
// 설치 필요: npm i pako
// App.jsx에서 사용:
//   import DiagramPanel from "./DiagramPanel";
//   ...
//   <DiagramPanel items={items} prices={prices} region="ap-northeast-2" />
import { useState, useMemo } from "react";
import { Network as NetIcon, Download, ExternalLink, Layers } from "lucide-react";
import * as pako from "pako";
import { buildArchitectureXml, downloadDrawio, openInDrawio } from "./drawio";

export default function DiagramPanel({ items, prices, region = "ap-northeast-2" }) {
  const [vpcName, setVpcName] = useState("main-vpc");
  const [vpcCidr, setVpcCidr] = useState("10.0.0.0/16");
  const [multiAzNet, setMultiAzNet] = useState(true);
  const [alb, setAlb] = useState(true);
  const [tierMap, setTierMap] = useState({}); // itemId -> "web" | "app"
  const [notice, setNotice] = useState("");

  // 견적에서 EC2/RDS 추출
  const ec2Items = useMemo(() => items.filter((it) => it.type === "ec2" && it.instanceType), [items]);
  const rdsItems = useMemo(() => items.filter((it) => it.type === "rds" && it.rdsKey), [items]);

  const azs = multiAzNet
    ? [`${region}a`, `${region}c`]
    : [`${region}a`];

  const buildConfig = () => ({
    region,
    vpcName,
    vpcCidr,
    azs,
    alb,
    ec2: ec2Items.map((it) => ({
      instanceType: it.instanceType,
      count: it.count || 1,
      tier: tierMap[it.id] || "web",
    })),
    rds: rdsItems.map((it) => {
      const meta = prices.rds?.[it.rdsKey] || {};
      return {
        instanceType: meta.instanceType || it.rdsKey,
        engine: meta.engine || "DB",
        multiAz: it.multiAz || multiAzNet,
      };
    }),
  });

  const onDownload = () => {
    if (ec2Items.length === 0 && rdsItems.length === 0) {
      setNotice("먼저 EC2 또는 RDS를 견적에 추가하세요.");
      return;
    }
    const xml = buildArchitectureXml(buildConfig());
    downloadDrawio(xml, `${vpcName || "architecture"}.drawio`);
    setNotice("architecture.drawio 다운로드됨 — draw.io에서 열어 편집하세요.");
  };

  const onOpen = () => {
    if (ec2Items.length === 0 && rdsItems.length === 0) {
      setNotice("먼저 EC2 또는 RDS를 견적에 추가하세요.");
      return;
    }
    const xml = buildArchitectureXml(buildConfig());
    const res = openInDrawio(xml, pako);
    if (!res.ok && res.reason === "too_long") {
      setNotice("구성이 커서 바로 열기 한계를 초과했습니다. 다운로드를 사용하세요.");
    } else if (!res.ok) {
      setNotice("열기 실패: " + res.reason + " — 다운로드를 사용하세요.");
    } else {
      setNotice("draw.io 새 탭에서 열렸습니다.");
    }
  };

  const setTier = (id, tier) => setTierMap((m) => ({ ...m, [id]: tier }));

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100">
          <Layers size={16} className="text-indigo-600" />
        </span>
        <h2 className="font-semibold text-slate-800">아키텍처 다이어그램</h2>
      </div>

      <p className="mb-3 text-sm text-slate-500">
        견적의 EC2·RDS에 네트워크 구성을 입혀 draw.io 아키텍처도를 생성합니다.
        다중 AZ·ALB·IGW·NAT·Public/Private 서브넷이 자동 배치됩니다.
      </p>

      {/* VPC / 네트워크 설정 */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-500">VPC 이름</span>
          <input value={vpcName} onChange={(e) => setVpcName(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-500">VPC CIDR</span>
          <input value={vpcCidr} onChange={(e) => setVpcCidr(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={multiAzNet} onChange={(e) => setMultiAzNet(e.target.checked)} className="h-4 w-4" />
          <span className="text-slate-600">다중 AZ</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={alb} onChange={(e) => setAlb(e.target.checked)} className="h-4 w-4" />
          <span className="text-slate-600">ALB 포함</span>
        </label>
      </div>

      {/* EC2 계층 지정 */}
      {ec2Items.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 text-xs font-medium text-slate-500">EC2 배치 (Public=web / Private=app)</div>
          <div className="space-y-1.5">
            {ec2Items.map((it) => (
              <div key={it.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <span className="font-mono text-slate-700">{it.instanceType} ×{it.count}</span>
                <div className="flex gap-1">
                  {["web", "app"].map((t) => (
                    <button key={t} onClick={() => setTier(it.id, t)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium ${(tierMap[it.id] || "web") === t ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                      {t === "web" ? "Public(web)" : "Private(app)"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RDS 표시 */}
      {rdsItems.length > 0 && (
        <div className="mb-3 text-xs text-slate-500">
          RDS {rdsItems.length}개는 Private 서브넷에 배치됩니다{multiAzNet ? " (다중 AZ: Primary/Standby)" : ""}.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button onClick={onOpen}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          <ExternalLink size={15} /> draw.io에서 열기
        </button>
        <button onClick={onDownload}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <Download size={15} /> .drawio 다운로드
        </button>
      </div>

      {notice && <div className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">{notice}</div>}
    </div>
  );
}
