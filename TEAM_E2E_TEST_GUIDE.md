# OneStage Event Helper and Ticketing E2E Test Guide

## Purpose

Please validate the Event Helper and ticketing flows against the latest `main` branches and record the results below. Do not commit credentials, screenshots containing personal data, `.env` files, or `variables.env`.

## Test Accounts

Use separate accounts for each role:

- **Organiser:** creates and publishes events and sets how many buyers are admitted at once. Publishing opens the event's queue; customers are admitted automatically.
- **Customer:** buys tickets and views QR codes.
- **Event helper:** scans tickets at the door.

Do not use the organiser/helper account to buy its own event tickets.

## Start the Environment

Frontend:

```bash
cd /Users/rohini/Project_Semester_2_OneStage
npm install
npm start
```

Backend, using the local MySQL database:

```bash
cd /Users/rohini/Project_Semester_2_OneStage/backend-repo
npm install
```

Start Docker Compose with the team's local environment configuration. Do not print or commit secret values.

Open:

- Frontend: `http://localhost:4200`
- API gateway: `http://localhost:8000`

## Test 1: Create and Publish an Event

1. Sign in as the organiser.
2. Open **Organiser > Events**.
3. Click **New event**.
4. Create a general-admission event:
   - Title: `Team E2E General Admission`
   - Future date/time
   - Total seats: `10`
   - Available buyers: `10`
   - Price: `5`
5. Click **Create event**.
6. Click **Publish**.

Expected result:

- The event appears as **On sale**.
- The public event page shows the title, venue, date, price, and seats remaining.

Record:

- Event ID:
- Result: PASS / FAIL
- Screenshot or notes:

## Test 2: General-Admission Customer Purchase

1. Sign out as organiser.
2. Sign in as the customer.
3. Open **Events**.
4. Open the test event. You land on its queue page, which joins the queue for you.
5. Wait to be admitted (usually about a second when nobody else is queuing; up to a minute if another buyer was admitted just before you). You are taken to ticket selection, with a countdown.
6. Select quantity `1`.
7. Click **Buy tickets** and complete the simulated payment.
8. Open **My events**.

Expected result:

- General-admission events go through the queue, the same as reserved-seating events.
- Simulated payment succeeds.
- The order appears in the **Orders** section.
- A ticket appears with a QR code and a section seat number (for example `A1`).
- Ticket status is **Ready to scan**.
- Event inventory decreases by one.

Record:

- Order ID:
- Ticket ID:
- Result: PASS / FAIL
- Notes:

## Test 3: Event Helper QR Image Upload

1. Keep the customer's QR code visible in **My events**.
2. Take a clear screenshot of the QR code.
3. Sign out as customer.
4. Sign in as the event helper.
5. Open **Event helper > Check-in**.
6. Select the assigned event.
7. Click **Upload QR image**.
8. Select the QR screenshot.

Expected result:

- The QR image is decoded.
- The result says: `Valid ticket. Check-in accepted.`
- The check-in counter increases.

Record:

- Result: PASS / FAIL
- Screenshot or notes:

## Test 4: Duplicate, Invalid, and Wrong-Event Tickets

### Duplicate ticket

Upload the same QR image again.

Expected: `Already used. This ticket was checked in earlier.`

### Invalid ticket

Upload an image that does not contain a QR code.

Expected: a clear invalid/unreadable QR message.

### Wrong event

Use a valid QR ticket from a different event.

Expected: `Wrong event. This ticket is not assigned to this event.`

Record:

- Duplicate: PASS / FAIL
- Invalid: PASS / FAIL
- Wrong event: PASS / FAIL

## Test 5: Manual Ticket Lookup

1. Open the helper check-in page.
2. Search using the customer's attendee name.
3. Search using the customer's email.
4. Search using the order ID.
5. Select a result and click **Check in**.

Expected result:

- Matching tickets appear.
- Search is limited to the selected event.
- Check-in returns the correct outcome.
- Already checked-in tickets are shown as duplicates.

Record:

- Name search: PASS / FAIL
- Email search: PASS / FAIL
- Order ID search: PASS / FAIL

## Test 6: Reserved Seating and the Queue

1. As organiser, create a reserved-seating event with at least 4 seats and set **Available buyers** to `1`.
2. Publish the event. There is no separate step to open the queue.
3. Sign in as customer A and open the reserved event. The queue page joins automatically.
4. Sign in as customer B in another browser and open the same event.
5. Confirm A is admitted and taken to seat selection, while B sees a queue position.
6. As B, go to **Events** or **My events** and confirm **Your active bookings** shows the place with **Return to queue** and **Release my place**.
7. As A, select an available seat and complete simulated payment.
8. Confirm B is admitted shortly after A pays (the freed place is refilled at once).
9. Open **My events** as A.

Expected result:

- Customers join the queue just by opening the event.
- Only as many customers as **Available buyers** can choose tickets at once; the others see their position.
- Opening `/events/<id>/tickets` directly without being admitted sends you back to the queue.
- Seat selection becomes available after admission.
- Selected seat is held during checkout and becomes sold after payment.
- A ticket and QR code are issued.

Record:

- Reserved event ID:
- Queue position:
- Seat label:
- Order ID:
- Ticket ID:
- Result: PASS / FAIL

## Test 7: Conflict and Token Safety

1. Use two customer accounts.
2. Set **Available buyers** to at least `2` so both customers are admitted together.
3. Have both customers attempt to select the same seat.
4. Confirm only one order succeeds.
5. Attempt to reuse an admission token for another order.
6. Test an expired admission token if possible.

Expected result:

- Only one customer can hold the same seat.
- The other receives a seat-conflict response.
- An admission token cannot be reused.
- Expired admission tokens are rejected.

Record:

- Seat conflict: PASS / FAIL
- Token reuse rejection: PASS / FAIL
- Token expiry rejection: PASS / FAIL

## Test 8: Organiser Views

As organiser, verify:

- **Sales:** revenue, tickets sold, capacity, and status are displayed.
- **Attendees:** paid attendee rows are displayed.
- **Event team:** helper invitation, acceptance, and roster are visible.
- **Check-in progress:** checked-in count updates after a scan.

Record:

- Sales: PASS / FAIL
- Attendees: PASS / FAIL
- Team roster: PASS / FAIL
- Check-in progress: PASS / FAIL

## Detailed Negative and Recovery Cases

### Authentication and authorization

1. Sign out and open `/my-events`, `/helper`, `/checkin/1`, and `/organiser/events`.
2. Confirm each protected route redirects to sign-in.
3. Sign in as a customer and open `/organiser/events`.
4. Sign in as a helper and try to open an event not assigned to that helper.

Expected result:

- Protected routes require authentication.
- Customers cannot use organiser management routes.
- Helpers cannot create, manage, or scan unassigned events.
- No access token or password appears in the UI or logs.

### Invalid order input

1. Use browser developer tools or an API client only with a valid customer token.
2. Submit quantity `0`, quantity greater than the allowed limit, a missing event ID, and malformed seat IDs.

Expected result:

- API returns a 4xx validation response.
- No order, hold, payment, or ticket is created.
- Inventory counts remain unchanged.

### Sold-out inventory

1. Create an event with a small capacity, such as `1` seat.
2. Buy the one available ticket.
3. Attempt another purchase as a different customer.

Expected result:

- First purchase succeeds.
- Second purchase returns an inventory conflict/sold-out response.
- No negative inventory is recorded.

### Seat conflict

1. Create a reserved event with at least two customer accounts.
2. Set **Available buyers** to at least `2` and have both customers open the event so both are admitted.
3. Have both customers select the same seat as close together as possible.
4. Submit both orders.

Expected result:

- Exactly one order succeeds.
- The other receives `seat_unavailable` or the documented conflict response.
- The seat has one final owner and is not double-issued.

### Queue idempotency

1. Join the same event queue twice using one customer account.
2. Refresh the queue page.
3. Check the displayed position and database/API response.

Expected result:

- The customer has one queue entry, not two.
- The position remains stable.
- Repeating the request does not create duplicate admission state.

### Admission token safety

1. Have a customer join the queue and be admitted.
2. Complete one reserved-seat checkout.
3. Attempt a second checkout using the same admission session/token.
4. Repeat after the token expiry time, if the test environment allows it.

Expected result:

- The first checkout can proceed.
- The admission is consumed or otherwise cannot be reused.
- Expired tokens are rejected.
- No second order is created from the same admission.

### Payment retry and ticket issuance

1. Create or locate a pending order.
2. Submit payment twice for the same order.
3. If ticket issuance is temporarily unavailable, retry payment after the Ticket service is healthy.

Expected result:

- A paid order is not charged or issued twice.
- Ticket issuance is idempotent.
- A retry can recover a paid order whose first ticket issuance attempt failed.
- The customer eventually sees the correct number of tickets.

### QR upload quality cases

Test each image separately:

1. Clear full-size QR screenshot.
2. Small QR crop with a white border.
3. QR image with low contrast.
4. Image with the QR partially cropped.
5. Non-image file or unsupported image.

Expected result:

- Clear and small-but-readable QR images decode.
- A valid image with no readable QR receives crop guidance: upload the original image or a crop with a clear white border around the whole QR code.
- A non-image file, including one renamed with a `.png` extension, says it could not be opened as an image and asks the helper to save the ticket QR as a PNG or JPG.
- Browser-blocked image decoding suggests using the camera or entering the QR token manually.
- A failed decode does not call ticket validation.
- Upload errors give useful guidance without directing the helper to the browser console.
- Temporary object URLs and file input state are cleaned up.

### Check-in concurrency

1. Open the same assigned event in two helper browser sessions.
2. Submit the same valid QR nearly simultaneously.
3. Repeat with two different valid tickets.

Expected result:

- The same ticket is accepted only once.
- One request returns success and the other duplicate.
- Different tickets can be checked in independently.
- The counter eventually matches the database state.

## Evidence to Capture

For every failure, record:

- Test case ID.
- Account role used, but never the password or token.
- Event ID, order ID, ticket ID, and seat label where applicable.
- URL and timestamp.
- Expected result.
- Actual result.
- HTTP status and sanitized response error, if available.
- Screenshot with email addresses and QR contents redacted.
- Correlation/request ID from logs, if available.

Do not attach raw access tokens, cookies, passwords, `.env`, `variables.env`, or unredacted QR codes.

## Automated Checks

Run these before reporting:

```bash
# Frontend
cd /Users/rohini/Project_Semester_2_OneStage
npm test -- --watch=false
npm run build

# Backend
cd backend-repo
npm test --workspace services/event
npm test --workspace services/inventory
npm test --workspace services/queue
npm test --workspace services/order
npm test --workspace services/ticket
npm test --workspace services/notification
```

## Report Format

Please send back:

```text
Tester:
Date:
Frontend commit:
Backend commit:

EH-01 helper access: PASS / FAIL
EH-02 QR scan/upload: PASS / FAIL
EH-03 outcomes: PASS / FAIL
EH-04 duplicate rejection: PASS / FAIL
EH-05 manual lookup: PASS / FAIL
EH-06 live counter: PASS / FAIL

General ticket purchase: PASS / FAIL
Reserved-seat purchase: PASS / FAIL
Queue join/admission: PASS / FAIL
Sales view: PASS / FAIL
Attendee view: PASS / FAIL

Failures:
Steps to reproduce:
Expected:
Actual:
Screenshots/log request IDs:
```

## Known Limitations

- Payment is simulated; no real payment provider is connected.
- Every event, general admission or reserved, sells through the queue. A customer who joins just after another was admitted can wait up to 60 seconds even when places are free.
- A separate customer account is required to test purchasing an organiser's event.
- A separate helper account is required to test helper-only membership behavior.
- Do not use production AWS data for destructive or load testing.
