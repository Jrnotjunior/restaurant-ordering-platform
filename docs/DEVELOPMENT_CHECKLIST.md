# Restaurant Ordering Platform — Development Checklist

## Status Legend

- ☐ Not started
- ◐ In progress
- ☑ Completed
- ⛔ Blocked
- — Not in current scope

## 1. Product Scope & Decisions

- ☑ Core concept: direct restaurant online ordering platform
- ☑ Customer can choose Pickup or Delivery
- ☑ Customer can pay online or choose Cash
- ☑ Restaurant's own drivers handle nearby deliveries
- ☑ Restaurant delivery radius is configurable; initial target is around 2–4 km
- ☑ Customers outside the restaurant delivery area may arrange a third-party courier
- ☑ POS is optional, not required for MVP
- ☑ Third-party courier automatic booking is not required for MVP
- ☑ System is designed for multiple restaurants
- ☐ Final product/brand name
- ☐ Final pricing/business model

## 2. Project Foundation

- ☑ Repository created: `restaurant-ordering-platform`
- ☑ `main` branch initialized
- ☑ `develop` branch created
- ☐ Finalize frontend framework/tooling
- ☐ Define project folder architecture
- ☐ Configure development environment
- ☐ Configure environment variables/secrets
- ☐ Configure Supabase project
- ☐ Define database migration strategy
- ☐ Define deployment environment

## 3. Architecture Rules

- ☑ Shared Header component — no page-by-page duplication
- ☑ Shared Footer component — no page-by-page duplication
- ☑ Shared dashboard layout
- ☑ Restaurant information must not be hard-coded
- ☑ Navigation must be reusable/configurable
- ☑ Branding/theme must be data/configuration-driven
- ☑ Reusable UI components instead of one-off duplicated components
- ☑ Separate UI, business logic, data access, and configuration
- ☐ Finalize folder/module architecture
- ☐ Document component conventions

## 4. Design System

- ☐ Define typography
- ☐ Define spacing scale
- ☐ Define border radius
- ☐ Define shadows
- ☐ Define primary/secondary colors
- ☐ Define success/warning/error states
- ☐ Define form/input styles
- ☐ Define button variants
- ☐ Define card styles
- ☐ Define modal/confirmation styles
- ☐ Define loading/empty/error states
- ☐ Implement theme variables/CSS tokens

## 5. Shared Customer Components

- ☐ Header
- ☐ Footer
- ☐ Navigation
- ☐ Product Card
- ☐ Category navigation
- ☐ Button
- ☐ Input
- ☐ Select
- ☐ Modal
- ☐ Toast/notification
- ☐ Status badge
- ☐ Cart item
- ☐ Order summary
- ☐ Address form
- ☐ Payment method selector
- ☐ Loading state
- ☐ Empty state
- ☐ Error state

## 6. Restaurant Configuration

- ☐ Restaurant name
- ☐ Slug/URL
- ☐ Logo
- ☐ Favicon
- ☐ Description
- ☐ Contact information
- ☐ Address/location
- ☐ Opening hours
- ☐ Social links
- ☐ Theme/branding colors
- ☐ Pickup settings
- ☐ Delivery settings
- ☐ Payment settings

## 7. Database & Multi-Tenancy

- ☐ Restaurants/tenants table
- ☐ Restaurant settings
- ☐ Users/profiles
- ☐ Roles/permissions
- ☐ Categories
- ☐ Products
- ☐ Product variants/add-ons
- ☐ Orders
- ☐ Order items
- ☐ Customer records
- ☐ Addresses
- ☐ Payments
- ☐ Delivery settings/rules
- ☐ Drivers
- ☐ Driver assignments
- ☐ Order status history
- ☐ Row Level Security policies
- ☐ Verify tenant data isolation

## 8. Customer Website

- ☐ Home
- ☐ Menu
- ☐ Product details
- ☐ Cart
- ☐ Checkout
- ☐ Order confirmation
- ☐ Order tracking
- ☐ About
- ☐ Contact
- ☐ Mobile responsive layout
- ☐ Restaurant-specific branding

## 9. Ordering Flow

- ☐ Browse menu
- ☐ Add product
- ☐ Select quantity
- ☐ Select variants/add-ons
- ☐ Update cart
- ☐ Remove cart item
- ☐ Validate product availability
- ☐ Choose Pickup/Delivery
- ☐ Calculate subtotal
- ☐ Calculate delivery fee
- ☐ Calculate final total
- ☐ Create order
- ☐ Prevent invalid/duplicate submissions
- ☐ Show order number

## 10. Pickup Flow

- ☐ Customer selects Pickup
- ☐ Show pickup information
- ☐ Show estimated preparation time
- ☐ Online-paid pickup order skips cashier payment
- ☐ Cash pickup order remains unpaid until cashier confirms payment
- ☐ Status: Pending → Confirmed → Preparing → Ready → Picked Up/Completed

## 11. Delivery Flow

- ☐ Customer selects Delivery
- ☐ Collect delivery address
- ☐ Validate address
- ☐ Determine delivery eligibility
- ☐ Configure maximum delivery distance
- ☐ Configure distance-based or flat delivery fees
- ☐ Show delivery fee before checkout
- ☐ Restaurant driver delivery option
- ☐ Assign driver
- ☐ Status: Preparing → Ready → Out for Delivery → Delivered
- ☐ Customer can track delivery status

## 12. Outside Delivery Zone / Third-Party Courier

- ☐ Detect address outside restaurant delivery area
- ☐ Explain restaurant-driver delivery is unavailable
- ☐ Offer third-party courier option where appropriate
- ☐ Clearly separate courier fee from restaurant delivery fee
- ☐ Provide restaurant pickup address/contact for courier arrangement
- ☐ Clearly communicate courier responsibility/limitations
- — Automatic courier booking is not required for MVP

## 13. Payments

- ☐ Select payment method
- ☐ Integrate chosen payment gateway
- ☐ Create payment transaction
- ☐ Receive provider confirmation/webhook
- ☐ Mark order PAID only after trusted payment confirmation
- ☐ Handle failed payments
- ☐ Handle cancelled/expired payments
- ☐ Cash order workflow
- ☐ Cashier can confirm cash payment
- ☐ Prevent payment/order duplication
- ☐ Define refund/cancellation behavior

## 14. Restaurant Dashboard

- ☐ Dashboard overview
- ☐ Real-time new order notifications
- ☐ Orders list
- ☐ Order details
- ☐ Accept/reject order
- ☐ Update order status
- ☐ Cancel order
- ☐ Menu management
- ☐ Category management
- ☐ Product availability
- ☐ Delivery settings
- ☐ Driver management
- ☐ Payment/order history
- ☐ Basic reports
- ☐ Restaurant settings

## 15. Kitchen / Order Display

- ☐ Real-time order arrival
- ☐ New orders clearly visible
- ☐ Order status controls
- ☐ Product quantities/add-ons visible
- ☐ Pickup vs delivery clearly identified
- ☐ Payment status clearly identified
- ☐ Driver delivery status visible
- ☐ Sound/visual notification option

## 16. Driver Features

- ☐ Driver account/role
- ☐ Assigned orders
- ☐ Customer delivery details
- ☐ Pickup/restaurant details
- ☐ Mark Out for Delivery
- ☐ Mark Delivered
- ☐ Delivery history
- — Live GPS tracking not required for MVP

## 17. POS Integration

- — POS is NOT required for MVP
- ☐ Research POS used by first target restaurant
- ☐ Confirm whether official API/integration exists
- ☐ Document supported POS capabilities
- ☐ Design integration layer
- ☐ Product/menu synchronization if supported
- ☐ Order synchronization if supported
- ☐ Payment/sales synchronization if supported
- ☐ Test integration without compromising core ordering system

## 18. Security & Reliability

- ☐ Authentication
- ☐ Role-based access
- ☐ Restaurant tenant isolation
- ☐ RLS policies reviewed
- ☐ Input validation
- ☐ Server-side authorization
- ☐ Payment webhook verification
- ☐ Rate limiting/abuse protection where needed
- ☐ Secure handling of secrets
- ☐ Error handling
- ☐ Logging
- ☐ Backup/recovery plan

## 19. Testing

- ☐ Unit tests for critical business logic
- ☐ Component tests for critical UI
- ☐ Customer ordering end-to-end test
- ☐ Pickup test
- ☐ Delivery-in-zone test
- ☐ Delivery-outside-zone test
- ☐ Online payment success test
- ☐ Online payment failure test
- ☐ Cash payment test
- ☐ Order cancellation test
- ☐ Real-time order update test
- ☐ Driver assignment test
- ☐ Multi-restaurant isolation test
- ☐ Mobile responsive test
- ☐ Browser compatibility test

## 20. MVP Release Checklist

- ☐ Customer can successfully place an order
- ☐ Restaurant receives order in real time
- ☐ Restaurant can process order
- ☐ Pickup flow works
- ☐ Restaurant-driver delivery works
- ☐ Outside-zone courier workflow is understandable
- ☐ Online payment is verified correctly
- ☐ Cash workflow works
- ☐ Restaurant can manage menu
- ☐ Restaurant can configure delivery
- ☐ Shared header/footer/layouts are used
- ☐ No restaurant-specific data is hard-coded
- ☐ Security/RLS reviewed
- ☐ Production database configured
- ☐ Production environment configured
- ☐ Monitoring/logging ready
- ☐ First restaurant pilot ready

## 21. Future / Post-MVP Ideas

- ☐ Official third-party courier integration
- ☐ POS integrations
- ☐ Online customer accounts
- ☐ Loyalty program
- ☐ Coupons/promotions
- ☐ Scheduled orders
- ☐ Advanced analytics
- ☐ Inventory management
- ☐ Multiple branches
- ☐ Driver live location
- ☐ Customer notifications/SMS
- ☐ Advanced delivery zones
- ☐ Native mobile app

## Decision Log

| ID | Decision | Status | Notes |
|---|---|---|---|
| D-001 | POS is optional | Confirmed | Core platform must work without a POS. |
| D-002 | Pickup supported | Confirmed | Online-paid pickup does not require cashier payment. |
| D-003 | Delivery supported | Confirmed | Restaurant's own drivers handle nearby deliveries. |
| D-004 | Delivery distance configurable | Confirmed | Initial target around 2–4 km; not hard-coded. |
| D-005 | Third-party courier outside zone | Confirmed | Automatic courier booking is not required for MVP. |
| D-006 | Online + cash payment | Confirmed | Payment status must be handled securely. |
| D-007 | Shared Header/Footer | Confirmed | Never duplicate layout code across pages. |
| D-008 | No hard-coded restaurant branding | Confirmed | Restaurant data comes from configuration/database. |
| D-009 | Multi-restaurant architecture | Confirmed | One platform/codebase should support multiple restaurants. |
| D-010 | Real-time orders | Confirmed | Restaurant/kitchen should receive order updates in real time. |
| D-011 | Reusable components | Confirmed | Build once and reuse across pages/restaurants. |
| D-012 | CRUD | Confirmed | Use Create, Read, Update, Delete patterns where applicable. |
| D-013 | Commit verification workflow | Confirmed | Every commit must include an exact changed-file report before testing. |

## Development Workflow

1. Plan one logical feature.
2. Implement it without unrelated changes.
3. Commit it with a clear message.
4. Report the exact files changed.
5. User verifies the commit in GitHub.
6. User tests the feature.
7. Fix issues if necessary.
8. Mark the checklist item complete.
9. Move to the next logical feature.

## Change Log

| Date | Change | Reason | Impact |
|---|---|---|---|
| 2026-09-28 | Initial checklist created | Establish a single source of truth | All future development should reference this checklist |

## Development Rule

Before implementing a new feature, check this document. If a feature changes an existing decision, update the Decision Log and relevant checklist before coding. Do not silently change the architecture during implementation.
