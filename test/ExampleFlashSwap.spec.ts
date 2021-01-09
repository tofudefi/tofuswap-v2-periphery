import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { MaxUint256 } from 'ethers/constants'
import { BigNumber, bigNumberify, defaultAbiCoder, formatEther } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './shared/utilities'
import { v2Fixture } from './shared/fixtures'

import ExampleFlashSwap from '../build/ExampleFlashSwap.json'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999,
  gasPrice: 0
}

describe('ExampleFlashSwap', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999
  })
  const [wallet] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet])

  let WTRX: Contract
  let WTRXPartner: Contract
  let WTRXExchangeV1: Contract
  let WTRXPair: Contract
  let flashSwapExample: Contract
  beforeEach(async function() {
    const fixture = await loadFixture(v2Fixture)

    WTRX = fixture.WTRX
    WTRXPartner = fixture.WTRXPartner
    WTRXExchangeV1 = fixture.WTRXExchangeV1
    WTRXPair = fixture.WTRXPair
    flashSwapExample = await deployContract(
      wallet,
      ExampleFlashSwap,
      [fixture.factoryV2.address, fixture.factoryV1.address, fixture.router.address],
      overrides
    )
  })

  it('uniswapV2Call:0', async () => {
    // add liquidity to V1 at a rate of 1 ETH / 200 X
    const WTRXPartnerAmountV1 = expandTo18Decimals(2000)
    const TRXAmountV1 = expandTo18Decimals(10)
    await WTRXPartner.approve(WTRXExchangeV1.address, WTRXPartnerAmountV1)
    await WTRXExchangeV1.addLiquidity(bigNumberify(1), WTRXPartnerAmountV1, MaxUint256, {
      ...overrides,
      value: TRXAmountV1
    })

    // add liquidity to V2 at a rate of 1 ETH / 100 X
    const WTRXPartnerAmountV2 = expandTo18Decimals(1000)
    const TRXAmountV2 = expandTo18Decimals(10)
    await WTRXPartner.transfer(WTRXPair.address, WTRXPartnerAmountV2)
    await WTRX.deposit({ value: TRXAmountV2 })
    await WTRX.transfer(WTRXPair.address, TRXAmountV2)
    await WTRXPair.mint(wallet.address, overrides)

    const balanceBefore = await WTRXPartner.balanceOf(wallet.address)

    // now, execute arbitrage via uniswapV2Call:
    // receive 1 ETH from V2, get as much X from V1 as we can, repay V2 with minimum X, keep the rest!
    const arbitrageAmount = expandTo18Decimals(1)
    // instead of being 'hard-coded', the above value could be calculated optimally off-chain. this would be
    // better, but it'd be better yet to calculate the amount at runtime, on-chain. unfortunately, this requires a
    // swap-to-price calculation, which is a little tricky, and out of scope for the moment
    const WTRXPairToken0 = await WTRXPair.token0()
    const amount0 = WTRXPairToken0 === WTRXPartner.address ? bigNumberify(0) : arbitrageAmount
    const amount1 = WTRXPairToken0 === WTRXPartner.address ? arbitrageAmount : bigNumberify(0)
    await WTRXPair.swap(
      amount0,
      amount1,
      flashSwapExample.address,
      defaultAbiCoder.encode(['uint'], [bigNumberify(1)]),
      overrides
    )

    const balanceAfter = await WTRXPartner.balanceOf(wallet.address)
    const profit = balanceAfter.sub(balanceBefore).div(expandTo18Decimals(1))
    const reservesV1 = [
      await WTRXPartner.balanceOf(WTRXExchangeV1.address),
      await provider.getBalance(WTRXExchangeV1.address)
    ]
    const priceV1 = reservesV1[0].div(reservesV1[1])
    const reservesV2 = (await WTRXPair.getReserves()).slice(0, 2)
    const priceV2 =
      WTRXPairToken0 === WTRXPartner.address ? reservesV2[0].div(reservesV2[1]) : reservesV2[1].div(reservesV2[0])

    expect(profit.toString()).to.eq('69') // our profit is ~69 tokens
    expect(priceV1.toString()).to.eq('165') // we pushed the v1 price down to ~165
    expect(priceV2.toString()).to.eq('123') // we pushed the v2 price up to ~123
  })

  it('uniswapV2Call:1', async () => {
    // add liquidity to V1 at a rate of 1 ETH / 100 X
    const WTRXPartnerAmountV1 = expandTo18Decimals(1000)
    const TRXAmountV1 = expandTo18Decimals(10)
    await WTRXPartner.approve(WTRXExchangeV1.address, WTRXPartnerAmountV1)
    await WTRXExchangeV1.addLiquidity(bigNumberify(1), WTRXPartnerAmountV1, MaxUint256, {
      ...overrides,
      value: TRXAmountV1
    })

    // add liquidity to V2 at a rate of 1 ETH / 200 X
    const WTRXPartnerAmountV2 = expandTo18Decimals(2000)
    const TRXAmountV2 = expandTo18Decimals(10)
    await WTRXPartner.transfer(WTRXPair.address, WTRXPartnerAmountV2)
    await WTRX.deposit({ value: TRXAmountV2 })
    await WTRX.transfer(WTRXPair.address, TRXAmountV2)
    await WTRXPair.mint(wallet.address, overrides)

    const balanceBefore = await provider.getBalance(wallet.address)

    // now, execute arbitrage via uniswapV2Call:
    // receive 200 X from V2, get as much ETH from V1 as we can, repay V2 with minimum ETH, keep the rest!
    const arbitrageAmount = expandTo18Decimals(200)
    // instead of being 'hard-coded', the above value could be calculated optimally off-chain. this would be
    // better, but it'd be better yet to calculate the amount at runtime, on-chain. unfortunately, this requires a
    // swap-to-price calculation, which is a little tricky, and out of scope for the moment
    const WTRXPairToken0 = await WTRXPair.token0()
    const amount0 = WTRXPairToken0 === WTRXPartner.address ? arbitrageAmount : bigNumberify(0)
    const amount1 = WTRXPairToken0 === WTRXPartner.address ? bigNumberify(0) : arbitrageAmount
    await WTRXPair.swap(
      amount0,
      amount1,
      flashSwapExample.address,
      defaultAbiCoder.encode(['uint'], [bigNumberify(1)]),
      overrides
    )

    const balanceAfter = await provider.getBalance(wallet.address)
    const profit = balanceAfter.sub(balanceBefore)
    const reservesV1 = [
      await WTRXPartner.balanceOf(WTRXExchangeV1.address),
      await provider.getBalance(WTRXExchangeV1.address)
    ]
    const priceV1 = reservesV1[0].div(reservesV1[1])
    const reservesV2 = (await WTRXPair.getReserves()).slice(0, 2)
    const priceV2 =
      WTRXPairToken0 === WTRXPartner.address ? reservesV2[0].div(reservesV2[1]) : reservesV2[1].div(reservesV2[0])

    expect(formatEther(profit)).to.eq('0.548043441089763649') // our profit is ~.5 ETH
    expect(priceV1.toString()).to.eq('143') // we pushed the v1 price up to ~143
    expect(priceV2.toString()).to.eq('161') // we pushed the v2 price down to ~161
  })
})
