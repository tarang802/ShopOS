#!/usr/bin/env bash
# End-to-end smoke test of the ShopOS API, phases 3 through 8.
#
# The checks assert exact stock figures, and the test itself moves stock, so it
# is NOT idempotent - running it twice without reseeding fails on the inventory
# assertions. `npm run smoke` therefore reseeds first. That only rebuilds the
# demo business (slug gupta-traders-demo); any organization you created yourself
# is untouched.
set -u
API=http://localhost:4000/api/v1
J=/tmp/shopos-cookies.txt
rm -f "$J"

pass=0; fail=0
check() {
  if [ "$1" = "$2" ]; then printf '  PASS  %s\n' "$3"; pass=$((pass+1));
  else printf '  FAIL  %s\n        expected=%s got=%s\n' "$3" "$2" "$1"; fail=$((fail+1)); fi
}

# Fail fast when the API is not running at all. Without this, every check
# reports a confusing "got=000" - curl's code for "could not connect" - and it
# looks like 36 broken features rather than one stopped server.
if ! curl -s -o /dev/null --max-time 5 "$API/health"; then
  echo
  echo "  The API is not responding at $API"
  echo "  Start it first:  npm run dev     (or: npm run dev:api)"
  echo
  exit 1
fi

echo "=== 1. Auth ==="
LOGIN=$(curl -s -c "$J" -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@guptatraders.test","password":"shopos-demo-2026"}')
# The auth limiter allows 10 attempts per 15 minutes, and this script spends
# several of them. Hitting it turns every later check into a confusing failure,
# so bail out with the real reason instead. The counter lives in the API
# process's memory, so restarting the API clears it immediately.
if printf '%s' "$LOGIN" | grep -q 'RATE_LIMITED'; then
  echo
  echo "  Rate limited on login. The API allows 10 attempts per 15 minutes."
  echo "  Restart the API to clear it (the counter is in memory), then re-run."
  echo
  exit 1
fi

TOKEN=$(echo "$LOGIN" | python -c "import sys,json; print(json.load(sys.stdin)['data']['accessToken'])" 2>/dev/null)
check "$([ -n "$TOKEN" ] && echo yes || echo no)" "yes" "login returns an access token"
ORG=$(echo "$LOGIN" | python -c "import sys,json; print(json.load(sys.stdin)['data']['organization']['name'])" 2>/dev/null)
check "$ORG" "Gupta Traders" "session is scoped to the right business"
PERMS=$(echo "$LOGIN" | python -c "import sys,json; print(len(json.load(sys.stdin)['data']['membership']['permissions']))" 2>/dev/null)
# Empty when login failed for some other reason - keep the arithmetic test from
# erroring on an empty string.
PERMS=${PERMS:-0}
check "$([ "$PERMS" -gt 30 ] && echo many || echo few)" "many" "owner holds the full permission set"

BAD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@guptatraders.test","password":"wrong-password"}')
check "$BAD" "401" "wrong password is rejected"

INJ=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":{"$gt":""},"password":"x"}')
check "$INJ" "400" "operator injection in email is rejected by validation"

AUTH="Authorization: Bearer $TOKEN"

NOAUTH=$(curl -s -o /dev/null -w '%{http_code}' "$API/products")
check "$NOAUTH" "401" "products require authentication"

echo
echo "=== 2. Catalogue and search ==="
SEARCH=$(curl -s -H "$AUTH" "$API/products?search=natraj")
PID=$(echo "$SEARCH" | python -c "import sys,json; d=json.load(sys.stdin)['data']; print(d[0]['_id'] if d else '')" 2>/dev/null)
PNAME=$(echo "$SEARCH" | python -c "import sys,json; d=json.load(sys.stdin)['data']; print(d[0]['name'] if d else '')" 2>/dev/null)
check "$PNAME" "Natraj 621 Pencil" "full-text search finds the pencil by brand"

PARTIAL=$(curl -s -H "$AUTH" "$API/products?search=penc" | python -c "import sys,json; print(len(json.load(sys.stdin)['data']))" 2>/dev/null)
PARTIAL=${PARTIAL:-0}
check "$([ "$PARTIAL" -gt 0 ] && echo found || echo none)" "found" "partial word search falls back to pattern match"

SKU=$(curl -s -H "$AUTH" "$API/products?search=SKU00001" | python -c "import sys,json; d=json.load(sys.stdin)['data']; print(len(d))" 2>/dev/null)
check "$SKU" "1" "exact item code returns exactly one product"

echo
echo "=== 3. Product detail: rates and branch stock ==="
DETAIL=$(curl -s -H "$AUTH" "$API/products/$PID")
LISTS=$(echo "$DETAIL" | python -c "import sys,json; print(len(json.load(sys.stdin)['data']['prices']))" 2>/dev/null)
check "$LISTS" "3" "all three rate lists appear on the product"
BRANCHES=$(echo "$DETAIL" | python -c "import sys,json; print(len(json.load(sys.stdin)['data']['stock']))" 2>/dev/null)
check "$BRANCHES" "3" "stock is shown for all three branches"
TOTAL=$(echo "$DETAIL" | python -c "import sys,json; print(json.load(sys.stdin)['data']['totalStock'])" 2>/dev/null)
check "$TOTAL" "2350" "total stock across branches is 1200+300+850"

echo
echo "=== 4. Pricing engine: the slab boundaries ==="
# Retail card: 1-9 = 500p, 10-49 = 480p, 50-99 = 450p, 100+ = 420p
for pair in "1:500" "9:500" "10:480" "49:480" "50:450" "99:450" "100:420" "5000:420"; do
  qty=${pair%%:*}; want=${pair##*:}
  got=$(curl -s -H "$AUTH" "$API/pricing/resolve?productId=$PID&quantity=$qty" \
    | python -c "import sys,json; print(json.load(sys.stdin)['data']['unitPricePaise'])" 2>/dev/null)
  check "$got" "$want" "quantity $qty resolves to $want paise"
done

ZERO=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" "$API/pricing/resolve?productId=$PID&quantity=0")
check "$ZERO" "400" "quantity of zero is rejected"

echo
echo "=== 5. Rejecting a bad rate card ==="
LISTID=$(curl -s -H "$AUTH" "$API/pricing/lists" | python -c "import sys,json; print(json.load(sys.stdin)['data'][0]['_id'])" 2>/dev/null)
OVERLAP=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/pricing/products/$PID" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"priceListId\":\"$LISTID\",\"tiers\":[{\"minQuantity\":1,\"maxQuantity\":10,\"pricePaise\":500},{\"minQuantity\":5,\"maxQuantity\":20,\"pricePaise\":480}]}")
check "$OVERLAP" "422" "overlapping slabs are refused"

GAP=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/pricing/products/$PID" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"priceListId\":\"$LISTID\",\"tiers\":[{\"minQuantity\":1,\"maxQuantity\":10,\"pricePaise\":500},{\"minQuantity\":20,\"maxQuantity\":null,\"pricePaise\":480}]}")
check "$GAP" "422" "a gap between slabs is refused"

NOSTART=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/pricing/products/$PID" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"priceListId\":\"$LISTID\",\"tiers\":[{\"minQuantity\":5,\"maxQuantity\":null,\"pricePaise\":500}]}")
check "$NOSTART" "422" "a card that does not start at 1 is refused"

echo
echo "=== 6. Inventory: adjustment ==="
BR=$(curl -s -H "$AUTH" "$API/branches?limit=10")
B1=$(echo "$BR" | python -c "import sys,json; d=json.load(sys.stdin)['data']; print([b['_id'] for b in d if b['code']=='MAIN'][0])" 2>/dev/null)
B2=$(echo "$BR" | python -c "import sys,json; d=json.load(sys.stdin)['data']; print([b['_id'] for b in d if b['code']=='PAT'][0])" 2>/dev/null)

ADJ=$(curl -s -X POST "$API/inventory/adjustments" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$B1\",\"reason\":\"DAMAGE\",\"notes\":\"Water damage in godown\",\"items\":[{\"productId\":\"$PID\",\"countedQuantity\":1150}]}")
ADJNUM=$(echo "$ADJ" | python -c "import sys,json; print(json.load(sys.stdin)['data']['number'])" 2>/dev/null)
check "$([ -n "$ADJNUM" ] && echo yes || echo no)" "yes" "adjustment created with a document number"

AFTER=$(curl -s -H "$AUTH" "$API/products/$PID" | python -c "
import sys,json
d=json.load(sys.stdin)['data']['stock']
print([s['quantity'] for s in d if s['branchName']=='Bhagalpur'][0])" 2>/dev/null)
check "$AFTER" "1150" "stock reduced from 1200 to the counted 1150"

echo
echo "=== 7. Inventory: transfer between branches ==="
TR=$(curl -s -X POST "$API/inventory/transfers" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"fromBranchId\":\"$B1\",\"toBranchId\":\"$B2\",\"items\":[{\"productId\":\"$PID\",\"quantity\":150}]}")
TRID=$(echo "$TR" | python -c "import sys,json; print(json.load(sys.stdin)['data']['_id'])" 2>/dev/null)
TRSTATUS=$(echo "$TR" | python -c "import sys,json; print(json.load(sys.stdin)['data']['status'])" 2>/dev/null)
check "$TRSTATUS" "IN_TRANSIT" "dispatched transfer sits in transit"

MID=$(curl -s -H "$AUTH" "$API/products/$PID" | python -c "
import sys,json
d=json.load(sys.stdin)['data']['stock']
print(str([s['quantity'] for s in d if s['branchName']=='Bhagalpur'][0])+','+str([s['quantity'] for s in d if s['branchName']=='Patna'][0]))" 2>/dev/null)
check "$MID" "1000,300" "stock has left the source but not yet arrived"

curl -s -X POST "$API/inventory/transfers/$TRID/receive" -H "$AUTH" -H 'Content-Type: application/json' -d '{}' > /dev/null
END=$(curl -s -H "$AUTH" "$API/products/$PID" | python -c "
import sys,json
d=json.load(sys.stdin)['data']['stock']
print(str([s['quantity'] for s in d if s['branchName']=='Bhagalpur'][0])+','+str([s['quantity'] for s in d if s['branchName']=='Patna'][0]))" 2>/dev/null)
check "$END" "1000,450" "stock arrived at the destination"

echo
echo "=== 8. Insufficient stock is refused ==="
TOOMUCH=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/inventory/transfers" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"fromBranchId\":\"$B1\",\"toBranchId\":\"$B2\",\"items\":[{\"productId\":\"$PID\",\"quantity\":999999}]}")
check "$TOOMUCH" "422" "sending more than is in stock is refused"

echo
echo "=== 9. Ledger and audit trail ==="
MOVES=$(curl -s -H "$AUTH" "$API/inventory/movements?productId=$PID&limit=20" \
  | python -c "import sys,json; print(len(json.load(sys.stdin)['data']))" 2>/dev/null)
check "$([ "$MOVES" -ge 5 ] && echo yes || echo no)" "yes" "every movement is in the ledger"

AUDIT=$(curl -s -H "$AUTH" "$API/audit-logs?limit=20" \
  | python -c "import sys,json; print(len(json.load(sys.stdin)['data']))" 2>/dev/null)
check "$([ "$AUDIT" -ge 3 ] && echo yes || echo no)" "yes" "audit entries were written"

echo
echo "=== 10. Permissions and branch scoping ==="
SLOGIN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"sunita@guptatraders.test","password":"shopos-demo-2026"}')
STOKEN=$(echo "$SLOGIN" | python -c "import sys,json; print(json.load(sys.stdin)['data']['accessToken'])" 2>/dev/null)
SAUTH="Authorization: Bearer $STOKEN"

DENY=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/pricing/products/$PID" -H "$SAUTH" -H 'Content-Type: application/json' \
  -d "{\"priceListId\":\"$LISTID\",\"tiers\":[{\"minQuantity\":1,\"maxQuantity\":null,\"pricePaise\":100}]}")
check "$DENY" "403" "sales staff cannot change rates"

DENY2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/inventory/adjustments" -H "$SAUTH" -H 'Content-Type: application/json' \
  -d "{\"branchId\":\"$B2\",\"reason\":\"DAMAGE\",\"items\":[{\"productId\":\"$PID\",\"countedQuantity\":1}]}")
check "$DENY2" "403" "sales staff cannot adjust stock"

SEE=$(curl -s -H "$SAUTH" "$API/products/$PID" | python -c "import sys,json; print(len(json.load(sys.stdin)['data']['stock']))" 2>/dev/null)
check "$SEE" "1" "branch-scoped staff see only their own branch stock"

CROSS=$(curl -s -o /dev/null -w '%{http_code}' -H "$SAUTH" "$API/inventory/stock?branchId=$B1")
check "$CROSS" "404" "branch-scoped staff cannot query another branch"

echo
echo "=================================================="
printf 'passed %s   failed %s\n' "$pass" "$fail"
echo "=================================================="
[ "$fail" -eq 0 ]
