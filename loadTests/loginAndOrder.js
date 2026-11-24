import http from 'k6/http';
import { check, group, sleep } from 'k6';

// Load test for JWT Pizza: log in, browse the menu, buy a pizza, then verify the
// pizza JWT the factory returns.
//
//   k6 run loadTests/loginAndOrder.js
//   k6 run -e BASE_URL=https://pizza-service.pizzeriaaaronearl.click loadTests/loginAndOrder.js
//
const BASE_URL = __ENV.BASE_URL || 'https://pizza-service.pizzeriaaaronearl.click';
const FACTORY_URL = __ENV.FACTORY_URL || 'https://pizza-factory.cs329.click';
const EMAIL = __ENV.PIZZA_EMAIL || 'k6-loadtest@jwt.com';
const PASSWORD = __ENV.PIZZA_PASSWORD || 'k6-loadtest-password';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const options = {
  stages: [
    { duration: '10s', target: 5 }, // ramp up to 5 virtual users
    { duration: '20s', target: 5 }, // hold the load
    { duration: '5s', target: 0 }, // ramp down
  ],
  thresholds: {
    checks: ['rate>0.95'],
    http_req_failed: ['rate<0.01'],
    'http_req_duration{expected_response:true}': ['p(95)<3000'],
  },
};

// Runs once before the load: make sure the test user exists, and cache the menu
// and a franchise/store so every virtual user does not have to look them up.
export function setup() {
  // The probe login is expected to fail the first time the test user does not
  // exist yet, so it must not count towards http_req_failed.
  const probeParams = {
    headers: JSON_HEADERS,
    responseCallback: http.expectedStatuses({ min: 200, max: 599 }),
  };

  const login = http.put(`${BASE_URL}/api/auth`, JSON.stringify({ email: EMAIL, password: PASSWORD }), {
    ...probeParams,
    tags: { name: 'setup_login' },
  });

  if (login.status !== 200) {
    http.post(
      `${BASE_URL}/api/auth`,
      JSON.stringify({ name: 'K6 Load Test', email: EMAIL, password: PASSWORD }),
      { ...probeParams, tags: { name: 'setup_register' } }
    );
    http.put(`${BASE_URL}/api/auth`, JSON.stringify({ email: EMAIL, password: PASSWORD }), {
      ...probeParams,
      tags: { name: 'setup_login' },
    });
  }

  const menu = http.get(`${BASE_URL}/api/order/menu`, { tags: { name: 'setup_menu' } });
  const franchises = http.get(`${BASE_URL}/api/franchise?page=0&limit=5&name=*`, {
    tags: { name: 'setup_franchises' },
  });

  let franchiseId = 1;
  let storeId = 1;
  const list = franchises.json()?.franchises || [];
  for (const franchise of list) {
    if (franchise.stores && franchise.stores.length > 0) {
      franchiseId = franchise.id;
      storeId = franchise.stores[0].id;
      break;
    }
  }

  return {
    email: EMAIL,
    password: PASSWORD,
    menu: menu.json() || [],
    franchiseId,
    storeId,
  };
}

export default function (data) {
  // 1. Log in and keep the authentication token for the purchase request.
  let authToken;
  group('login', () => {
    const res = http.put(
      `${BASE_URL}/api/auth`,
      JSON.stringify({ email: data.email, password: data.password }),
      { headers: JSON_HEADERS, tags: { name: 'login' } }
    );

    check(res, {
      'login succeeded with status 200': (r) => r.status === 200,
      'login returned an authentication token': (r) => Boolean(r.json('token')),
    });

    authToken = res.json('token');
  });

  // 2. Navigate the menu and choose a pizza to order.
  let menuItem;
  group('menu', () => {
    const res = http.get(`${BASE_URL}/api/order/menu`, { tags: { name: 'menu' } });

    check(res, {
      'menu loaded with status 200': (r) => r.status === 200,
      'menu contains at least one pizza': (r) => Array.isArray(r.json()) && r.json().length > 0,
    });

    const menu = res.json();
    if (Array.isArray(menu) && menu.length > 0) {
      menuItem = menu[Math.floor(Math.random() * menu.length)];
    }
  });

  // 3. Buy the pizza. The pizza JWT comes back in the purchase response.
  let pizzaJwt;
  group('purchase', () => {
    const payload = JSON.stringify({
      franchiseId: data.franchiseId,
      storeId: data.storeId,
      items: [
        {
          menuId: menuItem.id,
          description: menuItem.title,
          price: menuItem.price,
        },
      ],
    });

    const res = http.post(`${BASE_URL}/api/order`, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      tags: { name: 'purchase' },
    });

    check(res, {
      'purchase succeeded with status 200': (r) => r.status === 200,
      'purchase returned a pizza JWT': (r) => Boolean(r.json('jwt')),
    });

    // Read the JWT from the response instead of hard coding it.
    pizzaJwt = res.json('jwt');
  });

  // 4. Validate the pizza JWT with the JWT Pizza Factory.
  group('verify', () => {
    const res = http.post(
      `${FACTORY_URL}/api/order/verify`,
      JSON.stringify({ jwt: pizzaJwt }),
      { headers: JSON_HEADERS, tags: { name: 'verify' } }
    );

    check(res, {
      'pizza JWT verified with status 200': (r) => r.status === 200,
      'pizza JWT is valid': (r) => r.json('message') === 'valid',
    });
  });

  sleep(1);
}
