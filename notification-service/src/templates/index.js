const {config} = require('../config');
function getOtpTemplate(otp, ttlMinutes) {
  return `
    <div style="
      font-family: Arial, sans-serif; 
      max-width: 420px; 
      margin: auto; 
      padding: 20px; 
      border: 1px solid #e5e5e5; 
      border-radius: 10px; 
      background: #ffffff;
      box-shadow: 0 4px 10px rgba(0,0,0,0.05);
    ">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #4A3AFF; margin: 0;">DesignKarle</h2>
      </div>

      <p style="font-size: 16px; color: #333;">
        Hi,
      </p>

      <p style="font-size: 16px; color: #333;">
        Welcome to <strong>DesignKarle</strong> 👋  
        Use the verification code below to complete your sign up:
      </p>

      <div style="text-align: center; margin: 30px 0;">
        <div style="
          display: inline-block; 
          padding: 14px 26px; 
          font-size: 32px; 
          letter-spacing: 8px; 
          font-weight: bold; 
          background: #F4F4FF; 
          border-radius: 8px; 
          color: #4A3AFF;
          border: 1px solid #e0e0ff;
        ">
          ${otp}
        </div>
      </div>

      <p style="font-size: 15px; color: #555;">
        This code will expire in <strong>${ttlMinutes} minutes</strong>.
      </p>

      <p style="font-size: 15px; color: #555;">
        If this wasn't you, please ignore this email.
      </p>

      <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;" />

      <p style="font-size: 14px; color: #888; text-align: center;">
        Happy Learning 🎉<br/>
        <strong>Team DesignKarle</strong>
      </p>
    </div>
  `;
}

function getWelcomeTemplate(firstName) {
  return `
    <div style="
      font-family: Arial, sans-serif; 
      max-width: 420px; 
      margin: auto; 
      padding: 20px; 
      border: 1px solid #e5e5e5; 
      border-radius: 10px; 
      background: #ffffff;
      box-shadow: 0 4px 10px rgba(0,0,0,0.05);
    ">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #4A3AFF; margin: 0;">DesignKarle</h2>
      </div>

      <p style="font-size: 16px; color: #333;">
        Hi <strong>${firstName}</strong>
      </p>

      <p style="font-size: 16px; color: #333;">
        Welcome to <strong>DesignKarle</strong> 👋  
        Your account has been successfully created and verified.
      </p>

      <div style="text-align: center; margin: 25px 0;">   
        <a href="${config.FRONTEND_URL}/login" 
          style="
            display: inline-block;
            padding: 12px 22px;
            background: #4A3AFF;
            color: white;
            font-size: 16px;
            font-weight: bold;
            text-decoration: none;
            border-radius: 6px;
          ">
          Login to Your Account
        </a>
      </div>

      <p style="font-size: 15px; color: #555;">
        If you did not create this account, please contact our support team immediately.
      </p>

      <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;" />

      <p style="font-size: 14px; color: #888; text-align: center;">
        Happy Learning 🎉<br/>
        <strong>Team DesignKarle</strong>
      </p>
    </div>
  `;
}

function getTicketConfirmationTemplate(ticketData) {
  const { pnr, trainName, trainNumber, from, to, date, passengers, amount } = ticketData;

  return `
    <div style="
      font-family: Arial, sans-serif; 
      max-width: 600px; 
      margin: auto; 
      padding: 20px; 
      border: 1px solid #e5e5e5; 
      border-radius: 10px; 
      background: #ffffff;
      box-shadow: 0 4px 10px rgba(0,0,0,0.05);
    ">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #4A3AFF; margin: 0;">🎫 Ticket Confirmed</h2>
      </div>

      <div style="background: #F4F4FF; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
        <p style="margin: 5px 0; font-size: 16px;"><strong>PNR:</strong> ${pnr}</p>
        <p style="margin: 5px 0; font-size: 16px;"><strong>Train:</strong> ${trainName} (${trainNumber})</p>
      </div>

      <div style="margin: 20px 0;">
        <p style="margin: 10px 0;"><strong>From:</strong> ${from}</p>
        <p style="margin: 10px 0;"><strong>To:</strong> ${to}</p>
        <p style="margin: 10px 0;"><strong>Date:</strong> ${date}</p>
        <p style="margin: 10px 0;"><strong>Amount Paid:</strong> ₹${amount}</p>
      </div>

      <div style="margin: 20px 0;">
        <h3 style="color: #333;">Passenger Details:</h3>
        ${passengers.map((p, i) => `
          <p style="margin: 5px 0;">${i + 1}. ${p.name} (${p.age} yrs, ${p.gender})</p>
        `).join('')}
      </div>

      <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;" />

      <p style="font-size: 14px; color: #888; text-align: center;">
        Safe Journey! 🚂<br/>
        <strong>Team IRCTC</strong>
      </p>
    </div>
  `;
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const FAILURE_REASON_MESSAGES = {
  payment_failed: 'Your payment could not be processed.',
  confirm_seats_failed: 'We could not confirm your seats with the inventory system.',
  booking_timeout: 'Your booking expired before payment was completed.',
};

const CANCELLATION_REASON_MESSAGES = {
  user_cancelled: 'You requested to cancel this booking.',
  schedule_cancelled: 'The train schedule for this booking was cancelled by IRCTC.',
};

function getBookingConfirmedTemplate(data) {
  const {
    bookingId,
    firstName,
    trainName,
    trainNumber,
    fromStationName,
    toStationName,
    departureDate,
    passengers = [],
    seats = [],
    totalAmount,
  } = data;

  return `
    <div style="
      font-family: Arial, sans-serif;
      max-width: 600px;
      margin: auto;
      padding: 20px;
      border: 1px solid #e5e5e5;
      border-radius: 10px;
      background: #ffffff;
      box-shadow: 0 4px 10px rgba(0,0,0,0.05);
    ">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #4A3AFF; margin: 0;">🎫 Booking Confirmed</h2>
      </div>

      <p style="font-size: 16px; color: #333;">
        Hi ${firstName ? `<strong>${firstName}</strong>` : 'there'},
      </p>

      <p style="font-size: 16px; color: #333;">
        Your train booking has been confirmed. Here are your journey details:
      </p>

      <div style="background: #F4F4FF; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0; font-size: 16px;"><strong>Booking ID:</strong> ${bookingId}</p>
        <p style="margin: 5px 0; font-size: 16px;"><strong>Train:</strong> ${trainName} (${trainNumber})</p>
      </div>

      <div style="margin: 20px 0;">
        ${fromStationName ? `<p style="margin: 10px 0;"><strong>From:</strong> ${fromStationName}</p>` : ''}
        ${toStationName ? `<p style="margin: 10px 0;"><strong>To:</strong> ${toStationName}</p>` : ''}
        <p style="margin: 10px 0;"><strong>Date:</strong> ${formatDate(departureDate)}</p>
        <p style="margin: 10px 0;"><strong>Amount Paid:</strong> ₹${totalAmount}</p>
      </div>

      ${seats.length ? `
      <div style="margin: 20px 0;">
        <h3 style="color: #333; margin-bottom: 10px;">Seats:</h3>
        ${seats.map(s => `
          <p style="margin: 5px 0;">Seat ${s.seatNumber} — ${s.seatType} (₹${s.price})</p>
        `).join('')}
      </div>` : ''}

      ${passengers.length ? `
      <div style="margin: 20px 0;">
        <h3 style="color: #333; margin-bottom: 10px;">Passenger Details:</h3>
        ${passengers.map((p, i) => `
          <p style="margin: 5px 0;">${i + 1}. ${p.name} (${p.age} yrs, ${p.gender})</p>
        `).join('')}
      </div>` : ''}

      <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;" />

      <p style="font-size: 14px; color: #888; text-align: center;">
        Safe Journey! 🚂<br/>
        <strong>Team IRCTC</strong>
      </p>
    </div>
  `;
}

function getBookingFailedTemplate(data) {
  const { bookingId, firstName, reason } = data;
  const friendlyReason = FAILURE_REASON_MESSAGES[reason] || 'Your booking could not be completed.';

  return `
    <div style="
      font-family: Arial, sans-serif;
      max-width: 600px;
      margin: auto;
      padding: 20px;
      border: 1px solid #e5e5e5;
      border-radius: 10px;
      background: #ffffff;
      box-shadow: 0 4px 10px rgba(0,0,0,0.05);
    ">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #4A3AFF; margin: 0;">Booking Unsuccessful</h2>
      </div>

      <p style="font-size: 16px; color: #333;">
        Hi ${firstName ? `<strong>${firstName}</strong>` : 'there'},
      </p>

      <p style="font-size: 16px; color: #333;">
        We're sorry — we were unable to complete your booking.
      </p>

      <div style="background: #F4F4FF; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0; font-size: 16px;"><strong>Booking ID:</strong> ${bookingId}</p>
        <p style="margin: 5px 0; font-size: 16px;"><strong>Reason:</strong> ${friendlyReason}</p>
      </div>

      <p style="font-size: 15px; color: #555;">
        If any amount was debited, it will be refunded to your original payment method automatically. You can try booking again from your IRCTC account.
      </p>

      <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;" />

      <p style="font-size: 14px; color: #888; text-align: center;">
        We're sorry for the inconvenience.<br/>
        <strong>Team IRCTC</strong>
      </p>
    </div>
  `;
}

function getBookingCancelledTemplate(data) {
  const { bookingId, firstName, reason, refundAmount } = data;
  const friendlyReason = CANCELLATION_REASON_MESSAGES[reason] || 'Your booking has been cancelled.';
  const refundLine = refundAmount && refundAmount > 0
    ? `A refund of <strong>₹${refundAmount}</strong> has been initiated and will be credited to your original payment method within 5–7 business days.`
    : `No refund is applicable for this cancellation.`;

  return `
    <div style="
      font-family: Arial, sans-serif;
      max-width: 600px;
      margin: auto;
      padding: 20px;
      border: 1px solid #e5e5e5;
      border-radius: 10px;
      background: #ffffff;
      box-shadow: 0 4px 10px rgba(0,0,0,0.05);
    ">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #4A3AFF; margin: 0;">Booking Cancelled</h2>
      </div>

      <p style="font-size: 16px; color: #333;">
        Hi ${firstName ? `<strong>${firstName}</strong>` : 'there'},
      </p>

      <p style="font-size: 16px; color: #333;">
        Your booking has been cancelled successfully.
      </p>

      <div style="background: #F4F4FF; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0; font-size: 16px;"><strong>Booking ID:</strong> ${bookingId}</p>
        <p style="margin: 5px 0; font-size: 16px;"><strong>Reason:</strong> ${friendlyReason}</p>
      </div>

      <p style="font-size: 15px; color: #555;">
        ${refundLine}
      </p>

      <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;" />

      <p style="font-size: 14px; color: #888; text-align: center;">
        We hope to see you onboard again soon.<br/>
        <strong>Team IRCTC</strong>
      </p>
    </div>
  `;
}

module.exports = {
  getOtpTemplate,
  getWelcomeTemplate,
  getTicketConfirmationTemplate,
  getBookingConfirmedTemplate,
  getBookingFailedTemplate,
  getBookingCancelledTemplate,
};