import { Wallet, Contract } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './utilities'

import TofuswapV2Factory from '@tofudefi/tofuswap-v2-core/build/TofuswapV2Factory.json'
import ITofuswapV2Pair from '@tofudefi/tofuswap-v2-core/build/ITofuswapV2Pair.json'

import ERC20 from '../../build/ERC20.json'
import WTRX9 from '../../build/WTRX9.json'
import TofuswapV1Exchange from '../../build/TofuswapV1Exchange.json'
import TofuswapV1Factory from '../../build/TofuswapV1Factory.json'
import TofuswapV2Router01 from '../../build/TofuswapV2Router01.json'
import TofuswapV2Migrator from '../../build/TofuswapV2Migrator.json'
import TofuswapV2Router02 from '../../build/TofuswapV2Router02.json'
import RouterEventEmitter from '../../build/RouterEventEmitter.json'

const overrides = {
  gasLimit: 9999999
}

interface V2Fixture {
  token0: Contract
  token1: Contract
  WTRX: Contract
  WTRXPartner: Contract
  factoryV1: Contract
  factoryV2: Contract
  router01: Contract
  router02: Contract
  routerEventEmitter: Contract
  router: Contract
  migrator: Contract
  WTRXExchangeV1: Contract
  pair: Contract
  WTRXPair: Contract
}

export async function v2Fixture(provider: Web3Provider, [wallet]: Wallet[]): Promise<V2Fixture> {
  // deploy tokens
  const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const WTRX = await deployContract(wallet, WTRX9)
  const WTRXPartner = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])

  // deploy V1
  const factoryV1 = await deployContract(wallet, TofuswapV1Factory, [])
  await factoryV1.initializeFactory((await deployContract(wallet, TofuswapV1Exchange, [])).address)

  // deploy V2
  const factoryV2 = await deployContract(wallet, TofuswapV2Factory, [wallet.address])

  // deploy routers
  const router01 = await deployContract(wallet, TofuswapV2Router01, [factoryV2.address, WTRX.address], overrides)
  const router02 = await deployContract(wallet, TofuswapV2Router02, [factoryV2.address, WTRX.address], overrides)

  // event emitter for testing
  const routerEventEmitter = await deployContract(wallet, RouterEventEmitter, [])

  // deploy migrator
  const migrator = await deployContract(wallet, TofuswapV2Migrator, [factoryV1.address, router01.address], overrides)

  // initialize V1
  await factoryV1.createExchange(WTRXPartner.address, overrides)
  const WTRXExchangeV1Address = await factoryV1.getExchange(WTRXPartner.address)
  const WTRXExchangeV1 = new Contract(WTRXExchangeV1Address, JSON.stringify(TofuswapV1Exchange.abi), provider).connect(
    wallet
  )

  // initialize V2
  await factoryV2.createPair(tokenA.address, tokenB.address)
  const pairAddress = await factoryV2.getPair(tokenA.address, tokenB.address)
  const pair = new Contract(pairAddress, JSON.stringify(ITofuswapV2Pair.abi), provider).connect(wallet)

  const token0Address = await pair.token0()
  const token0 = tokenA.address === token0Address ? tokenA : tokenB
  const token1 = tokenA.address === token0Address ? tokenB : tokenA

  await factoryV2.createPair(WTRX.address, WTRXPartner.address)
  const WTRXPairAddress = await factoryV2.getPair(WTRX.address, WTRXPartner.address)
  const WTRXPair = new Contract(WTRXPairAddress, JSON.stringify(ITofuswapV2Pair.abi), provider).connect(wallet)

  return {
    token0,
    token1,
    WTRX,
    WTRXPartner,
    factoryV1,
    factoryV2,
    router01,
    router02,
    router: router02, // the default router, 01 had a minor bug
    routerEventEmitter,
    migrator,
    WTRXExchangeV1,
    pair,
    WTRXPair
  }
}
