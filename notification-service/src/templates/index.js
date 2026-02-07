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

module.exports = {
  getOtpTemplate,
  getWelcomeTemplate,
  getTicketConfirmationTemplate,
};