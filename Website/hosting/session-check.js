// CloudFront Function (cloudfront-js-2.0), viewer-request, on every request except /auth/*.
// KEY (the session signing key) is prepended by the template. Lets a request through only with a valid session cookie:
//   jf_session = <expiry-seconds>.<cognito-sub>.<hex hmac-sha256 of "<expiry>.<sub>">
// Anything else is sent to /auth/login. The cookie is issued by the auth Lambda after a successful Cognito sign-in.
var crypto = require('crypto');

function valid(cookie) {
  var parts = String(cookie || '').split('.');
  if (parts.length !== 3) return false;
  var exp = Number(parts[0]);
  if (!(exp > Math.floor(Date.now() / 1000))) return false;
  var want = crypto.createHmac('sha256', KEY).update(parts[0] + '.' + parts[1]).digest('hex');
  return want === parts[2];
}

function handler(event) {
  var request = event.request;
  var c = request.cookies && request.cookies.jf_session;
  if (c && valid(c.value)) return request;
  return {
    statusCode: 302,
    statusDescription: 'Found',
    headers: { location: { value: '/auth/login' }, 'cache-control': { value: 'no-store' } },
  };
}
