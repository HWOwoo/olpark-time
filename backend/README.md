# 올팍타임 서버리스 백엔드 (AWS, 배포 준비 단계)

> **현재 상태**: 코드와 배포 설정만 준비되어 있고 아직 배포하지 않았습니다.
> 시연판은 GitHub Pages(임시)로 운영 중이며, 공공데이터포털 인증키 발급 후 이 구성으로 이전할 예정입니다.

## 구성

```
[브라우저] ──▶ CloudFront ──▶ S3 (정적 웹: index.html, app.js …)
     │
     └──▶ API Gateway(HTTP API) ──▶ Lambda api_proxy ──▶ data.go.kr
                                         ▲ 인증키: SSM Parameter Store(SecureString)
EventBridge Scheduler ──▶ Lambda collector ──▶ data.go.kr ──▶ S3 (raw/ 원본 보관)
   · 10분마다: 실시간 주차현황
   · 매일 06:00(KST): 공연정보, 입출차·공연·날씨 연계 데이터
CloudWatch 경보 ──▶ SNS 이메일 (수집 실패 시)
```

| 파일 | 역할 |
|---|---|
| `template.yaml` | AWS SAM 템플릿(전체 인프라). `cfn-lint` 검사 통과 |
| `src/api_proxy.py` | `GET /api/{source}` — 인증키를 서버에서 붙여 포털 호출, 허용 파라미터만 통과, 60초 캐시, 장애 시 마지막 값 반환 |
| `src/collector.py` | 일정 수집 — 응답 원본을 `raw/{source}/YYYY/MM/DD/HHMMSS.json`으로 S3에 저장 |
| `src/common.py` | 인증키 조회, URL 생성, XML→JSON 변환, 응답 형식 |
| `tests/` | AWS 없이 도는 단위 테스트 11개 (`python -m unittest discover -s tests`) |

## 비용·안전 장치

- 서버를 상시 켜 두지 않는 구조(EC2 미사용)라 트래픽이 적을 때 비용이 거의 들지 않습니다.
- Lambda 동시 실행 상한(API 5, 수집 2), HTTP API 요청 제한(초당 10, 순간 20), 로그 보관 14일.
- 인증키는 코드·저장소·브라우저 어디에도 두지 않고 SSM SecureString에만 보관합니다.
- 배포 전에 AWS 콘솔에서 **예산 경보(Budgets)**를 꼭 설정하세요.

## 배포 순서 (인증키·AWS 계정 준비 후)

1. 사전 준비: AWS 계정, 배포 권한 사용자, AWS CLI·SAM CLI 설치, `aws configure`
2. 인증키 저장 (공공데이터포털 마이페이지의 **디코딩** 키):
   ```bash
   aws ssm put-parameter --name /olpark-time/service-key --type SecureString --value "<디코딩 인증키>" --region ap-northeast-2
   ```
3. 활용신청한 각 API의 상세 명세에서 요청 주소를 확인해 배포 파라미터로 넣습니다.
   ```bash
   sam build
   sam deploy --guided --region ap-northeast-2 \
     --parameter-overrides UrlRealtimeParking=<주소> UrlLinkedData=<주소> UrlPerformances=<주소> AlarmEmail=<이메일>
   ```
4. 정적 웹 업로드 (출력값 `SiteBucketName`, `SiteDistributionId` 사용):
   ```bash
   aws s3 sync .. s3://<SiteBucketName> --exclude "backend/*" --exclude "analysis/*" --exclude ".git/*"
   aws cloudfront create-invalidation --distribution-id <SiteDistributionId> --paths "/*"
   ```
5. 출력값 `ApiBaseUrl`을 `config.js`의 `API_BASE`에 넣고, `AllowedOrigin`을 CloudFront(또는 개인 도메인) 주소로 바꿔 다시 배포합니다.
6. 개인 도메인을 쓰면 DNS만 CloudFront로 바꾸면 되므로 기획서에 적은 주소가 바뀌지 않습니다.

## 남은 일

- 활용신청 후 실제 응답 항목에 맞춰 수집 데이터를 시간대별 주차 대수로 가공하는 단계 추가
- 2025년 연계 데이터로 예측 모델 학습·월 1회 재학습 작업 추가
- 알림 구독(DynamoDB), 기관 대시보드(2단계)
