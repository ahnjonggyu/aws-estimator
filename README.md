# AWS 비용 견적 계산기

서울 리전(ap-northeast-2) 기준 EC2 · RDS · EBS · 데이터 전송 비용을 빠르게 견적할 수 있는 사내 배포용 정적 웹앱입니다.

**라이브 URL**: https://ahnjonggyu.github.io/aws-estimator/

## 주요 기능

- EC2 / RDS 7세대 이상 인스턴스 검색 (vCPU · 메모리 필터)
- RDS MySQL · PostgreSQL, Single-AZ / Multi-AZ 선택
- EBS gp3 스토리지 자동 합산
- 데이터 전송(아웃바운드) 비용 (첫 100 GB 무료 적용)
- 견적 이름 저장 · 불러오기 (localStorage 기반)
- 시작 시 `prices.json` 자동 로드, 실패 시 내장 폴백 단가 사용

## 폴더 구조

```
aws-estimator/
├── .github/workflows/
│   └── deploy.yml           # main push → GitHub Pages 자동 배포
├── public/
│   └── prices.json          # AWS 단가 데이터 (커밋 필수)
├── scripts/
│   └── update-prices.js     # 단가 갱신 스크립트 (ESM)
├── src/
│   ├── App.jsx              # 메인 앱 (fetch: import.meta.env.BASE_URL)
│   ├── index.css            # Tailwind 진입점
│   └── main.jsx
├── tailwind.config.js
├── postcss.config.js
└── vite.config.js           # base: '/aws-estimator/'
```

## 로컬 개발

```bash
npm install
npm run dev        # http://localhost:5173
```

## 단가 갱신

AWS Price List Bulk API에서 최신 단가를 내려받아 `public/prices.json`을 갱신합니다.

```bash
# EC2 offer 파일이 수백 MB이므로 메모리 옵션 권장
node --max-old-space-size=8192 scripts/update-prices.js

# 또는 npm 스크립트로 실행
npm run update-prices
```

갱신 후에는 **`public/prices.json`을 반드시 커밋**해야 배포에 반영됩니다.

```bash
git add public/prices.json
git commit -m "chore: update AWS prices ($(date +%Y-%m-%d))"
git push
```

갱신 주기 권장: **월 1회** (신규 인스턴스 추가 또는 가격 변동 시)

## GitHub Pages 배포

`main` 브랜치에 push하면 `.github/workflows/deploy.yml`이 자동으로 실행되어 배포됩니다.

```
main push
  → GitHub Actions: npm ci → npm run build
  → dist/ → GitHub Pages
  → https://ahnjonggyu.github.io/aws-estimator/
```

### 최초 설정 (저장소에서 1회)

GitHub 저장소 → **Settings → Pages → Source: GitHub Actions** 로 설정해야 합니다.

### 수동 트리거

Actions 탭 → "Deploy to GitHub Pages" → "Run workflow" 로 수동 실행도 가능합니다.

## 단가 데이터 구조 (`prices.json`)

```jsonc
{
  "_meta": { "region": "ap-northeast-2", "updated": "ISO8601", ... },
  "ec2": {
    "m7i.large": { "hourly": 0.1134, "vcpu": 2, "memory": "8 GiB" }
  },
  "rds": {
    "MySQL|db.m7g.large": { "engine": "MySQL", "instanceType": "db.m7g.large", "hourly": 0.198, ... }
  },
  "ebs": {
    "gp3": { "perGbMonth": 0.0912 }
  }
}
```

앱 UI의 "가격 교체" 버튼으로 파일을 직접 업로드해 임시 교체도 가능합니다.

## 주의 사항

- 이 앱의 단가는 **정보 제공용 추정치**입니다.
- 무료 티어 · 예약 인스턴스 · Savings Plan · 세금은 반영되지 않습니다.
- 예산 확정 전 반드시 [AWS 공식 요금 계산기](https://calculator.aws/pricing/2/home)에서 확인하세요.
