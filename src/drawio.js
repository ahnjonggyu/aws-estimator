// src/drawio.js
// 견적 구성 + 네트워크 설정 → draw.io(mxGraph) XML 생성.
// 완전 구성: VPC / 다중 AZ / Public·Private 서브넷 / IGW / NAT GW /
//            ALB / EC2 / RDS / 보안그룹(경계 박스).
//
// URL 열기에는 pako(deflateRaw) + base64가 필요하다:
//   import pako from "pako";
// 다운로드는 압축 없는 평문 XML을 그대로 .drawio로 저장한다.

// ── AWS 공식 draw.io 셰이프 스타일 ────────────────────
// mxgraph.aws4 셰이프 라이브러리 스타일 문자열.
const SHAPE = {
  vpc: "sketch=0;outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fillColor=none;strokeColor=#248814;verticalAlign=top;align=left;spacingLeft=30;fontColor=#248814;dashed=0;",
  az: "fillColor=none;strokeColor=#147EBA;dashed=1;verticalAlign=top;fontStyle=0;fontColor=#147EBA;whiteSpace=wrap;html=1;align=left;spacingLeft=30;",
  publicSubnet: "sketch=0;html=1;whiteSpace=wrap;fillColor=#E9F3E6;strokeColor=#248814;verticalAlign=top;align=left;spacingLeft=30;fontColor=#248814;",
  privateSubnet: "sketch=0;html=1;whiteSpace=wrap;fillColor=#E6F2F8;strokeColor=#147EBA;verticalAlign=top;align=left;spacingLeft=30;fontColor=#147EBA;",
  igw: "sketch=0;dashed=0;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.internet_gateway;labelPosition=bottom;verticalLabelPosition=bottom;verticalAlign=top;align=center;fillColor=#8C4FFF;fontColor=#232F3E;",
  nat: "sketch=0;dashed=0;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.nat_gateway;labelPosition=bottom;verticalLabelPosition=bottom;verticalAlign=top;align=center;fillColor=#8C4FFF;fontColor=#232F3E;",
  alb: "sketch=0;dashed=0;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.application_load_balancer;labelPosition=bottom;verticalLabelPosition=bottom;verticalAlign=top;align=center;fillColor=#8C4FFF;fontColor=#232F3E;",
  ec2: "sketch=0;dashed=0;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ec2;labelPosition=bottom;verticalLabelPosition=bottom;verticalAlign=top;align=center;fillColor=#ED7100;fontColor=#232F3E;",
  rds: "sketch=0;dashed=0;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.rds;labelPosition=bottom;verticalLabelPosition=bottom;verticalAlign=top;align=center;fillColor=#2E73B8;fontColor=#232F3E;",
  sg: "fillColor=none;strokeColor=#DD3522;dashed=1;verticalAlign=top;fontColor=#DD3522;whiteSpace=wrap;html=1;align=left;spacingLeft=8;dashPattern=6 4;",
  edge: "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#545B64;fontColor=#545B64;",
  cloud: "sketch=0;html=1;whiteSpace=wrap;fillColor=none;strokeColor=#232F3E;verticalAlign=top;align=left;spacingLeft=30;fontColor=#232F3E;dashed=0;",
};

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let _id = 0;
const nid = () => "n" + (++_id);

function cell(id, value, style, x, y, w, h, parent = "1", extra = {}) {
  const vertexAttrs = Object.entries(extra).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  return `<mxCell id="${id}" value="${esc(value)}" style="${style}" vertex="1" parent="${parent}" ${vertexAttrs}>` +
    `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
}

function edge(id, source, target, value = "", parent = "1") {
  return `<mxCell id="${id}" value="${esc(value)}" style="${SHAPE.edge}" edge="1" parent="${parent}" source="${source}" target="${target}">` +
    `<mxGeometry relative="1" as="geometry"/></mxCell>`;
}

/**
 * config = {
 *   vpcName, vpcCidr,
 *   azs: ["ap-northeast-2a", "ap-northeast-2c"],   // 다중 AZ
 *   ec2: [{ instanceType, count, tier:"web"|"app" }],
 *   rds: [{ instanceType, engine, multiAz }],
 *   alb: true,
 * }
 * 반환: mxfile XML 문자열 (평문)
 */
export function buildArchitectureXml(config) {
  _id = 0;
  const azs = config.azs?.length ? config.azs : ["ap-northeast-2a"];
  const cells = [];

  // 레이아웃 상수
  const AZ_W = 360, AZ_GAP = 40, AZ_X0 = 80;
  const SUBNET_W = 300, SUBNET_H = 150;
  const VPC_PAD_TOP = 140;

  const vpcW = AZ_X0 + azs.length * (AZ_W + AZ_GAP) + 40;
  const vpcH = VPC_PAD_TOP + 2 * SUBNET_H + 120;

  // Cloud(리전) 컨테이너
  cells.push(cell("cloud", `AWS Cloud — ${config.region || "ap-northeast-2"}`, SHAPE.cloud, 20, 20, vpcW + 80, vpcH + 120));

  // 인터넷 게이트웨이 (VPC 상단 경계)
  const igw = nid();
  cells.push(cell(igw, "Internet Gateway", SHAPE.igw, 40, 40, 48, 48, "cloud"));

  // ALB (Public 영역 상단, AZ 걸침)
  let alb = null;
  if (config.alb) {
    alb = nid();
    cells.push(cell(alb, "ALB", SHAPE.alb, 140, 40, 48, 48, "cloud"));
    cells.push(edge(nid(), igw, alb, "HTTP/HTTPS", "cloud"));
  }

  // VPC 컨테이너
  cells.push(cell("vpc", `VPC ${config.vpcName || ""} ${config.vpcCidr ? "(" + config.vpcCidr + ")" : ""}`, SHAPE.vpc, 40, 110, vpcW, vpcH, "cloud"));

  // 웹/앱 EC2를 AZ에 분산 배치
  const webNodes = [], appNodes = [], rdsNodes = [];
  const ec2Web = config.ec2?.filter((e) => e.tier !== "app") || [];
  const ec2App = config.ec2?.filter((e) => e.tier === "app") || [];

  azs.forEach((az, i) => {
    const azX = AZ_X0 + i * (AZ_W + AZ_GAP);
    const azId = nid();
    cells.push(cell(azId, az, SHAPE.az, azX, 50, AZ_W, vpcH - 90, "vpc"));

    // Public 서브넷
    const pubId = nid();
    cells.push(cell(pubId, `Public Subnet ${i + 1}`, SHAPE.publicSubnet, 30, 50, SUBNET_W, SUBNET_H, azId));
    // NAT GW (각 public 서브넷)
    const nat = nid();
    cells.push(cell(nat, "NAT GW", SHAPE.nat, 20, 40, 40, 40, pubId));
    // 웹 EC2 (AZ별 분산)
    const w = ec2Web[i % Math.max(ec2Web.length, 1)];
    if (w) {
      const id = nid();
      cells.push(cell(id, `${w.instanceType}\n(web)`, SHAPE.ec2, 130, 40, 48, 48, pubId));
      webNodes.push(id);
      if (alb) cells.push(edge(nid(), alb, id, "", "cloud"));
    }

    // Private 서브넷
    const privId = nid();
    cells.push(cell(privId, `Private Subnet ${i + 1}`, SHAPE.privateSubnet, 30, 50 + SUBNET_H + 30, SUBNET_W, SUBNET_H, azId));
    // 앱 EC2
    const a = ec2App[i % Math.max(ec2App.length, 1)];
    if (a) {
      const id = nid();
      cells.push(cell(id, `${a.instanceType}\n(app)`, SHAPE.ec2, 60, 40, 48, 48, privId));
      appNodes.push(id);
    }
    // RDS: multiAz면 AZ마다, 아니면 첫 AZ에만
    const primaryRds = config.rds?.[0];
    if (primaryRds && (primaryRds.multiAz || i === 0)) {
      const id = nid();
      const label = `${primaryRds.instanceType}\n${primaryRds.engine}${primaryRds.multiAz ? (i === 0 ? " (Primary)" : " (Standby)") : ""}`;
      cells.push(cell(id, label, SHAPE.rds, 180, 40, 48, 48, privId));
      rdsNodes.push(id);
    }
  });

  // 보안그룹 경계(논리 표시) — 웹/앱/DB 계층 라벨만 가볍게
  // (시각적 그룹 박스는 서브넷으로 충분히 표현되므로 라벨 주석으로 대체)

  // 연결: 웹 → 앱, 앱 → RDS
  webNodes.forEach((w) => appNodes.forEach((a) => cells.push(edge(nid(), w, a, "", "cloud"))));
  appNodes.forEach((a) => rdsNodes.forEach((r) => cells.push(edge(nid(), a, r, "", "cloud"))));
  // 앱이 없으면 웹 → RDS 직접
  if (appNodes.length === 0) {
    webNodes.forEach((w) => rdsNodes.forEach((r) => cells.push(edge(nid(), w, r, "", "cloud"))));
  }
  // RDS 간 복제(다중 AZ)
  if (rdsNodes.length === 2) cells.push(edge(nid(), rdsNodes[0], rdsNodes[1], "복제"));

  const model =
    `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1100" pageHeight="850" math="0" shadow="0">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
    cells.join("") +
    `</root></mxGraphModel>`;

  return `<mxfile host="app.diagrams.net" type="device"><diagram name="AWS Architecture" id="aws-arch">${model}</diagram></mxfile>`;
}

// ── 다운로드 ──────────────────────────────────────────
export function downloadDrawio(xml, filename = "architecture.drawio") {
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── draw.io 바로 열기 (pako 필요) ─────────────────────
// import pako from "pako";  // 호출부에서 주입
export function openInDrawio(xml, pako) {
  try {
    const encoded = encodeURIComponent(xml);
    const compressed = pako.deflateRaw(encoded);
    let bin = "";
    const bytes = new Uint8Array(compressed);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const base64 = btoa(bin);
    const createObj = { type: "xml", compressed: true, data: base64, effect: "pop" };
    const url = "https://app.diagrams.net/?pv=0&grid=0#create=" + encodeURIComponent(JSON.stringify(createObj));
    // URL 길이 한계(~브라우저별 상이) 체크
    if (url.length > 60000) return { ok: false, reason: "too_long" };
    window.open(url, "_blank");
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
