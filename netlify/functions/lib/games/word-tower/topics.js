'use strict';
// 워드 타워 문제: 주제 10개 (하 3 · 중 3+1 · 상 3). 각 주제의 answer 7개를 섞은 알파벳 큐브가 한 라운드의 문제입니다.
//  - answer : [영어 단어, 한글 뜻] 7개 (출제용 정답 예시. 라운드가 끝나면 학생에게 뜻과 함께 보여 줍니다)
//  - extra  : 정답 예시는 아니지만 그 주제에 맞는 초등 수준 단어. 이 단어들로 7개를 만들어도 정답으로 인정합니다.
//  난이도: low(하) 단어가 짧고 쉬움 · mid(중) 4~7글자 · high(상) 5~9글자의 긴 단어가 섞임
// 새 주제를 넣으려면 아래 형식으로 한 덩어리를 더하면 됩니다. (answer 는 반드시 7개, 알파벳 대문자)
const T = (id, name, emoji, level, answer, extra) => ({
  id, name, emoji, level,
  answer: answer.map((a) => a[0]),
  ko: Object.fromEntries(answer),
  accept: [...new Set([...answer.map((a) => a[0]), ...extra.split(/\s+/).filter(Boolean)])],
});

module.exports = [
  // ---------- 하 ----------
  T('colors', '색깔', '🎨', 'low',
    [['PINK', '분홍색'], ['BLUE', '파란색'], ['GREEN', '초록색'], ['BLACK', '검은색'], ['WHITE', '흰색'], ['BROWN', '갈색'], ['ORANGE', '주황색']],
    'RED YELLOW PURPLE GRAY GREY GOLD SILVER NAVY BEIGE IVORY VIOLET'),
  T('body', '신체', '🧍', 'low',
    [['HEAD', '머리'], ['FACE', '얼굴'], ['NOSE', '코'], ['HAND', '손'], ['FOOT', '발'], ['MOUTH', '입'], ['KNEE', '무릎']],
    'ARM LEG EAR EYE HAIR NECK BACK TOE CHIN LIP TOOTH TEETH FINGER ELBOW CHEST THUMB SKIN BODY HEART SHOULDER STOMACH'),
  T('weather', '날씨', '⛅', 'low',
    [['SUNNY', '맑은'], ['RAINY', '비 오는'], ['WINDY', '바람 부는'], ['SNOWY', '눈 오는'], ['CLOUDY', '구름 낀'], ['STORM', '폭풍'], ['FOGGY', '안개 낀']],
    'COLD HOT WARM COOL RAIN SNOW WIND CLOUD SUN FOG STORMY THUNDER LIGHTNING FROZEN ICY DRY WET HUMID SKY TYPHOON RAINBOW'),
  // ---------- 중 ----------
  T('jobs', '직업', '💼', 'mid',
    [['TEACHER', '선생님'], ['DOCTOR', '의사'], ['FARMER', '농부'], ['PILOT', '조종사'], ['DANCER', '무용수'], ['NURSE', '간호사'], ['SINGER', '가수']],
    'CHEF ARTIST DENTIST POLICE FIREFIGHTER ACTOR ACTRESS BAKER DRIVER WRITER SCIENTIST ENGINEER VET COOK MUSICIAN PAINTER PLAYER SOLDIER JUDGE LAWYER REPORTER DESIGNER ASTRONAUT CLERK GUARD MAYOR'),
  T('sports', '스포츠', '⚽', 'mid',
    [['SOCCER', '축구'], ['TENNIS', '테니스'], ['BOXING', '권투'], ['SKIING', '스키'], ['GOLF', '골프'], ['YOGA', '요가'], ['JUDO', '유도']],
    'BASEBALL BASKETBALL VOLLEYBALL BADMINTON SWIMMING RUNNING SKATING SURFING DANCING HOCKEY RUGBY BOWLING CYCLING FISHING HIKING CLIMBING TAEKWONDO ARCHERY CRICKET SOFTBALL'),
  T('countries', '나라', '🌍', 'mid',
    [['KOREA', '한국'], ['CHINA', '중국'], ['FRANCE', '프랑스'], ['ITALY', '이탈리아'], ['EGYPT', '이집트'], ['MEXICO', '멕시코'], ['GERMANY', '독일']],
    'JAPAN INDIA SPAIN CANADA BRAZIL RUSSIA AMERICA ENGLAND THAILAND TURKEY GREECE PERU CUBA KENYA NEPAL IRAN IRAQ ISRAEL NORWAY SWEDEN FINLAND POLAND AUSTRALIA VIETNAM MONGOLIA IRELAND HOLLAND ICELAND QATAR CHILE LAOS'),
  T('transport', '교통수단', '🚌', 'mid',
    [['TRAIN', '기차'], ['SUBWAY', '지하철'], ['TAXI', '택시'], ['PLANE', '비행기'], ['TRUCK', '트럭'], ['BICYCLE', '자전거'], ['SHIP', '배']],
    'BUS CAR BIKE BOAT MOTORCYCLE HELICOPTER ROCKET TRAM FERRY VAN SCOOTER JET SUBMARINE AMBULANCE TRACTOR WAGON CAB'),
  // ---------- 상 ----------
  T('fruits', '과일', '🍍', 'high',
    [['PINEAPPLE', '파인애플'], ['BLUEBERRY', '블루베리'], ['BANANA', '바나나'], ['PEACH', '복숭아'], ['LEMON', '레몬'], ['MANGO', '망고'], ['PLUM', '자두']],
    'APPLE ORANGE GRAPE CHERRY PEAR KIWI MELON WATERMELON STRAWBERRY COCONUT AVOCADO DURIAN LIME FIG DATE PAPAYA APRICOT TANGERINE GRAPEFRUIT RASPBERRY PERSIMMON BERRY GUAVA LYCHEE OLIVE'),
  T('animals', '동물', '🐘', 'high',
    [['ELEPHANT', '코끼리'], ['KANGAROO', '캥거루'], ['DOLPHIN', '돌고래'], ['RABBIT', '토끼'], ['TIGER', '호랑이'], ['MONKEY', '원숭이'], ['SQUIRREL', '다람쥐']],
    'GIRAFFE PIG ZEBRA WOLF FOX BUTTERFLY PENGUIN LION BEAR DEER HORSE SHEEP COW DOG CAT MOUSE RAT SNAKE FROG DUCK GOOSE EAGLE OWL BAT SHARK WHALE TURTLE CROCODILE HIPPO RHINO PANDA KOALA CAMEL GORILLA CHICKEN GOAT HAMSTER PARROT OTTER BEE ANT FISH BIRD LEOPARD CHEETAH'),
  T('food', '음식', '🍔', 'high',
    [['HAMBURGER', '햄버거'], ['SPAGHETTI', '스파게티'], ['SANDWICH', '샌드위치'], ['PANCAKE', '팬케이크'], ['COOKIE', '쿠키'], ['SALAD', '샐러드'], ['PIZZA', '피자']],
    'BREAD RICE SOUP STEAK NOODLE CHICKEN CAKE PIE EGG MILK JUICE CHEESE BUTTER TOAST CEREAL DONUT CANDY CHOCOLATE PASTA CURRY KIMCHI SUSHI TACO BURGER FRIES SAUSAGE YOGURT JAM HONEY SNACK DESSERT BACON PORK BEEF FISH TOFU'),
];
