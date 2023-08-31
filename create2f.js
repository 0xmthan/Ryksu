const speakeasy = require('speakeasy')
const qrcode = require ('qrcode')

var secret = speakeasy.generateSecret({name: "FatEcat"})

console.log(secret);
qrcode.toDataURL(secret.otpauth_url, function(err, data){
    console.log(data)
})