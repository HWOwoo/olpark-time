// 올팍타임 설정
// 공공데이터포털(data.go.kr) 인증키를 넣으면 실시간 API 연동 모드로 전환할 수 있도록 자리를 마련해 두었습니다.
// 현재 시연판은 인증키 없이 2024년 7월 실제 입출차 기록을 재생하는 "시연 모드"로 동작합니다.
window.OLPARK_CONFIG = {
  SERVICE_KEY: '',
  API: {
    realtimeParking: 'https://www.data.go.kr/data/15168686/openapi.do', // 실시간 주차현황
    linkedData: 'https://www.data.go.kr/data/15164822/openapi.do',      // 차량입출차·공연·날씨 연계 데이터
    performances: 'https://www.data.go.kr/data/3037877/openapi.do',      // 올림픽공원 공연정보
  },
};
