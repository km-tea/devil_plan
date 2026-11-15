'use strict';
// 교사 아이디·학급 코드는 이제 교사가 처음 로그인할 때 직접 정합니다(teachers 테이블).
module.exports = {
  allowGuest: () => process.env.ALLOW_GUEST === '1', // 테스트용: 로그인 없이 이름만으로 입장
};
