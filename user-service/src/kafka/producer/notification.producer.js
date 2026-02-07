const { producer, connectProducer } = require('../../config/kafka');
const logger = require('../../config/logger');
const { TOPICS } = require('../../utils/constants');

class NotificationProducer {
     constructor() {
          this.isInitialized = false;
     }

     async initialize() {
          if (!this.isInitialized) {
               await connectProducer();
               this.isInitialized = true;
          }
     }


     async sendMessage(topic, key, value){
          try{
               await this.initialize();

               const message = {
                    topic,
                    messages: [{
                         key: key || `${topic}-${Date.now()}`,
                         value: JSON.stringify(value),
                         timeStamp: Date.now().toString()
                    }]
               }

               const result = await producer.send(message);
               logger.info(`Message sent to kafka topic: ${topic}`, {
                    key,
                    partition: result[0].partition,
                    offset: result[0].offset,
               });
               
               return result;
          }catch(error){
               logger.error(`Failed to send message to kafka topic: ${topic}`, {
                    error: error.message,
                    stack: error.stack,
                    key
               })
               throw error;
          }
     }
     async sendOtpEmail(email, otp, ttlMinutes = 5){
          return this.sendMessage(
               TOPICS.OTP_EMAIL,
               `otp-${email}`,
               {email, otp, ttlMinutes}
          )
     }

     async sendWelcomeEmail(email, firstName){
          return this.sendMessage(
               TOPICS.WELCOME_EMAIL,
               `welcome-${email}`,
               {email, firstName}
          )
     }
}

module.exports = new NotificationProducer();