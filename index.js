const Web3 = require('web3')
const axios = require("axios")
const {HttpsProxyAgent} = require('https-proxy-agent')
const fs = require('fs')
const colors = require('simple-log-colors')

const rpc = 'https://bsc.blockpi.network/v1/rpc/public'
const ticketCost = 500
let summaryTickets = 0

const headers = {
  'authority': 'api.cyberconnect.dev',
  'accept': '*/*',
  'accept-language': 'en-GB,en;q=0.9,uk-UA;q=0.8,uk;q=0.7,ru-RU;q=0.6,ru;q=0.5,en-US;q=0.4',
  'content-type': 'application/json',
  'origin': 'https://link3.to',
  'referer': 'https://link3.to/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
}

async function connectToMetaMask(privateKey) {
  // Подключение к удаленному RPC-серверу
  const web3 = new Web3(rpc)

  // Получение аккаунта из приватного ключа
  const account = web3.eth.accounts.privateKeyToAccount(privateKey)

  // Установка провайдера MetaMask в Web3
  web3.eth.defaultAccount = account.address

  // Проверка подключения
  const networkId = await web3.eth.net.getId()
  console.log(`Connected to network with ID: ${colors.yellow(networkId)}, account address: ${colors.yellow(account.address)}`)

  let address = account.address

  return {
    web3: web3,
    address: address
  }
}

async function getNonce(address) {
  let jsonData = {
    query: '\n    mutation nonce($address: EVMAddress!) {\n  nonce(request: {address: $address}) {\n    status\n    message\n    data\n  }\n}\n    ',
    variables: {
      address: address
    },
    operationName: 'nonce'
  }

  let response = await axios.post('https://api.cyberconnect.dev/profile/', jsonData, {
    headers: headers
  })

  return await response.data.data.nonce.data
}

async function signSignature(message, privateKey, web3) {
  let signedMessage = web3.eth.accounts.sign(message, privateKey)
  return signedMessage.signature
}

async function getAuthToken(address, message, signature, proxy) {
  let jsonData = {
    query: '\n    mutation login($address: EVMAddress!, $signature: String!, $signedMessage: String!, $token: String, $isEIP1271: Boolean, $chainId: Int) {\n  login(\n    request: {address: $address, signature: $signature, signedMessage: $signedMessage, token: $token, isEIP1271: $isEIP1271, chainId: $chainId}\n  ) {\n    status\n    message\n    data {\n      id\n      privateInfo {\n        address\n        accessToken\n        kolStatus\n      }\n    }\n  }\n}\n    ',
    variables: {
      signedMessage: message,
      token: '',
      address: address,
      chainId: 56,
      signature: signature,
      isEIP1271: false
    },
    operationName: 'login',
  }

  let response = await axios.post('https://api.cyberconnect.dev/profile/', jsonData, {
    headers: headers,
    httpAgent: new HttpsProxyAgent(`http://${proxy}`)
  })

  return response.data.data.login.data.privateInfo.accessToken
}

async function getFanPoints(authToken, proxy) {
  let rewardsHeaders = {
    'authority': 'api.cyberconnect.dev',
    'accept': '*/*',
    'authorization': authToken,
    'content-type': 'application/json',
    'origin': 'https://link3.to',
    'referer': 'https://link3.to/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
  }

  let jsonData = {
    query: "\n    query getLoyaltyMemberPassStatus($handle: String!) {\n  loyaltyProgram(handle: $handle) {\n    membershipPass {\n      totalPoints\n      availablePoints\n      joinedAt\n      level\n      previousLevelPoints\n      nextLevelPoints\n    }\n    rewardsCount\n  }\n}\n    ",
    variables: {
      handle: "cyberconnect",
    },
    operationName: 'getLoyaltyMemberPassStatus',
  }

  let response = await axios.post('https://api.cyberconnect.dev/profile/', jsonData, {
    headers: rewardsHeaders,
    httpAgent: new HttpsProxyAgent(`http://${proxy}`)
  })

  return response.data.data.loyaltyProgram.membershipPass.availablePoints
}

async function insufficientFanPoints(authToken, proxy, fp) {
  let fanPoints = Number(fp)
  let rewardsHeaders = {
    'authority': 'api.cyberconnect.dev',
    'accept': '*/*',
    'authorization': authToken,
    'content-type': 'application/json',
    'origin': 'https://link3.to',
    'referer': 'https://link3.to/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
  }

  if (fanPoints >= ticketCost) {
    let possibleTickets = Math.floor(fanPoints / ticketCost)

    let jsonData = {
      operationName: "consumePoints",
      query: "\n    mutation consumePoints($id: ID!, $count: Int!) {\n  consumePoints(input: {rewardId: $id, count: $count}) {\n    status\n  }\n}\n    ",
      variables: {
        count: possibleTickets,
        id: "ce1fb713-f10c-4356-b1d3-074cce310fe7",
      },
    }

    await axios.post('https://api.cyberconnect.dev/profile/', jsonData, {
      headers: rewardsHeaders,
      httpAgent: new HttpsProxyAgent(`http://${proxy}`)
    })
  } else {
    console.log(colors.yellow(`Not enough FP for ticket (need ${ticketCost}FP)`));
    console.log(colors.yellow(`Account FP: ${fanPoints}`));
  }

  let jsonData = {
    operationName: "getLoyaltyProgramRewards",
    query: "\n    query getLoyaltyProgramRewards($handle: String!, $filter: LoyaltyProgramRewardFilter) {\n  loyaltyProgram(handle: $handle) {\n    rewards(filter: $filter) {\n      id\n      title\n      type\n      drawTime\n      startTime\n      endTime\n      rewards {\n        name\n        image\n        count\n      }\n      requirement {\n        points\n        type\n      }\n      totalTickets\n      sidePoolTickets\n      mainPoolTickets\n      userReward {\n        ownedTickets\n        wonRewards {\n          name\n          image\n          count\n        }\n      }\n      totalWinners\n    }\n  }\n}\n    ",
    variables: {
      handle: 'cyberconnect',
      filter: "REWARD_AVAILABLE",
    },
  }

  let response = await axios.post('https://api.cyberconnect.dev/profile/', jsonData, {
    headers: rewardsHeaders,
    httpAgent: new HttpsProxyAgent(`http://${proxy}`)
  })

  return response.data.data.loyaltyProgram.rewards[0].userReward.ownedTickets
}

const readFile = (filePath) => {
  return fs.readFileSync(filePath, 'utf8').split('\n')
}

const clearTrashSymbols = (arr) => {
  return arr.map(el => el.trim())
}

function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function start() {
  let privatesArr
  let proxiesArr

  privatesArr = readFile('./privates.txt')
  privatesArr = clearTrashSymbols(privatesArr)
  proxiesArr = readFile('./proxies.txt')
  proxiesArr = clearTrashSymbols(proxiesArr)

  if ((privatesArr.length === proxiesArr.length)) {
    for (let i = 0; i < privatesArr.length; i++) {
      await new Promise(async (resolve) => {
        setTimeout(async () => {
          let {address, web3} = await connectToMetaMask(privatesArr[i])
          let nonce = await getNonce(address)
          let message = `link3.to wants you to sign in with your Ethereum account:\n${address}\n\n\nURI: https://link3.to\nVersion: 1\nChain ID: 56\nNonce: ${nonce}\nIssued At: 2023-03-19T14:04:18.580Z\nExpiration Time: 2023-04-02T14:04:18.580Z\nNot Before: 2023-03-19T14:04:18.580Z`
          let signature = await signSignature(message, privatesArr[i], web3)
          let authToken = await getAuthToken(address, message, signature, proxiesArr[i])
          let fpTotal = await getFanPoints(authToken, proxiesArr[i])
          let totalTickets = await insufficientFanPoints(authToken, proxiesArr[i], fpTotal)

          summaryTickets += Number(totalTickets)

          if (i % 2 === 0) {
            console.log(`Номер кошелька: ${colors.cyan(i + 1)}`)
            console.log(`ACCOUNT ADDRESS: ${colors.cyan(address)}`)
            console.log(colors.magenta(`Total tickets: ${totalTickets}`))
          } else {
            console.log(`${(`Номер кошелька: ${colors.green(i + 1)}`)}`)
            console.log(`ACCOUNT ADDRESS: ${colors.green(address)}`)
            console.log(colors.magenta(`Total tickets: ${totalTickets}`))
          }
          console.log(`==============================================================================================`)
          resolve()
        }, getRandomDelay(3000, 5000))
      })
    }
  } else {
    if (privatesArr.length > proxiesArr.length) {
      console.log(`${colors.red(`Недостаточно прокси: кошельков - ${privatesArr.length}, прокси - ${proxiesArr.length}`)}`)
    } else if (privatesArr.length < proxiesArr.length) {
      console.log(`${colors.red(`Недостаточно кошельков: кошельков - ${privatesArr.length}, прокси - ${proxiesArr.length}`)}`)
    } else {
      console.log(`${colors.red(`Непредвиденная ошибка`)}`)
    }
  }

  console.log(colors.blue(`Summary tickets: ${summaryTickets}`))
}

start()