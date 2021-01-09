import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { AddressZero, Zero, MaxUint256 } from 'ethers/constants'
import { BigNumber, bigNumberify } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'
import { ecsign } from 'ethereumjs-util'

import { expandTo18Decimals, getApprovalDigest, mineBlock, MINIMUM_LIQUIDITY } from './shared/utilities'
import { v2Fixture } from './shared/fixtures'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

enum RouterVersion {
  UniswapV2Router01 = 'UniswapV2Router01',
  UniswapV2Router02 = 'UniswapV2Router02'
}

describe('UniswapV2Router{01,02}', () => {
  for (const routerVersion of Object.keys(RouterVersion)) {
    const provider = new MockProvider({
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999
    })
    const [wallet] = provider.getWallets()
    const loadFixture = createFixtureLoader(provider, [wallet])

    let token0: Contract
    let token1: Contract
    let WTRX: Contract
    let WTRXPartner: Contract
    let factory: Contract
    let router: Contract
    let pair: Contract
    let WTRXPair: Contract
    let routerEventEmitter: Contract
    beforeEach(async function() {
      const fixture = await loadFixture(v2Fixture)
      token0 = fixture.token0
      token1 = fixture.token1
      WTRX = fixture.WETH
      WTRXPartner = fixture.WETHPartner
      factory = fixture.factoryV2
      router = {
        [RouterVersion.UniswapV2Router01]: fixture.router01,
        [RouterVersion.UniswapV2Router02]: fixture.router02
      }[routerVersion as RouterVersion]
      pair = fixture.pair
      WTRXPair = fixture.WETHPair
      routerEventEmitter = fixture.routerEventEmitter
    })

    afterEach(async function() {
      expect(await provider.getBalance(router.address)).to.eq(Zero)
    })

    describe(routerVersion, () => {
      it('factory, WTRX', async () => {
        expect(await router.factory()).to.eq(factory.address)
        expect(await router.WTRX()).to.eq(WTRX.address)
      })

      it('addLiquidity', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)

        const expectedLiquidity = expandTo18Decimals(2)
        await token0.approve(router.address, MaxUint256)
        await token1.approve(router.address, MaxUint256)
        await expect(
          router.addLiquidity(
            token0.address,
            token1.address,
            token0Amount,
            token1Amount,
            0,
            0,
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(token0, 'Transfer')
          .withArgs(wallet.address, pair.address, token0Amount)
          .to.emit(token1, 'Transfer')
          .withArgs(wallet.address, pair.address, token1Amount)
          .to.emit(pair, 'Transfer')
          .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
          .to.emit(pair, 'Transfer')
          .withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(pair, 'Sync')
          .withArgs(token0Amount, token1Amount)
          .to.emit(pair, 'Mint')
          .withArgs(router.address, token0Amount, token1Amount)

        expect(await pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      })

      it('addLiquidityTRX', async () => {
        const WTRXPartnerAmount = expandTo18Decimals(1)
        const TRXAmount = expandTo18Decimals(4)

        const expectedLiquidity = expandTo18Decimals(2)
        const WTRXPairToken0 = await WTRXPair.token0()
        await WTRXPartner.approve(router.address, MaxUint256)
        await expect(
          router.addLiquidityTRX(
            WTRXPartner.address,
            WTRXPartnerAmount,
            WTRXPartnerAmount,
            TRXAmount,
            wallet.address,
            MaxUint256,
            { ...overrides, value: TRXAmount }
          )
        )
          .to.emit(WTRXPair, 'Transfer')
          .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
          .to.emit(WTRXPair, 'Transfer')
          .withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(WTRXPair, 'Sync')
          .withArgs(
            WTRXPairToken0 === WTRXPartner.address ? WTRXPartnerAmount : TRXAmount,
            WTRXPairToken0 === WTRXPartner.address ? TRXAmount : WTRXPartnerAmount
          )
          .to.emit(WTRXPair, 'Mint')
          .withArgs(
            router.address,
            WTRXPairToken0 === WTRXPartner.address ? WTRXPartnerAmount : TRXAmount,
            WTRXPairToken0 === WTRXPartner.address ? TRXAmount : WTRXPartnerAmount
          )

        expect(await WTRXPair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      })

      async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
        await token0.transfer(pair.address, token0Amount)
        await token1.transfer(pair.address, token1Amount)
        await pair.mint(wallet.address, overrides)
      }
      it('removeLiquidity', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)
        await addLiquidity(token0Amount, token1Amount)

        const expectedLiquidity = expandTo18Decimals(2)
        await pair.approve(router.address, MaxUint256)
        await expect(
          router.removeLiquidity(
            token0.address,
            token1.address,
            expectedLiquidity.sub(MINIMUM_LIQUIDITY),
            0,
            0,
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(pair, 'Transfer')
          .withArgs(wallet.address, pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(pair, 'Transfer')
          .withArgs(pair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(token0, 'Transfer')
          .withArgs(pair.address, wallet.address, token0Amount.sub(500))
          .to.emit(token1, 'Transfer')
          .withArgs(pair.address, wallet.address, token1Amount.sub(2000))
          .to.emit(pair, 'Sync')
          .withArgs(500, 2000)
          .to.emit(pair, 'Burn')
          .withArgs(router.address, token0Amount.sub(500), token1Amount.sub(2000), wallet.address)

        expect(await pair.balanceOf(wallet.address)).to.eq(0)
        const totalSupplyToken0 = await token0.totalSupply()
        const totalSupplyToken1 = await token1.totalSupply()
        expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(500))
        expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(2000))
      })

      it('removeLiquidityTRX', async () => {
        const WTRXPartnerAmount = expandTo18Decimals(1)
        const TRXAmount = expandTo18Decimals(4)
        await WTRXPartner.transfer(WTRXPair.address, WTRXPartnerAmount)
        await WTRX.deposit({ value: TRXAmount })
        await WTRX.transfer(WTRXPair.address, TRXAmount)
        await WTRXPair.mint(wallet.address, overrides)

        const expectedLiquidity = expandTo18Decimals(2)
        const WTRXPairToken0 = await WTRXPair.token0()
        await WTRXPair.approve(router.address, MaxUint256)
        await expect(
          router.removeLiquidityTRX(
            WTRXPartner.address,
            expectedLiquidity.sub(MINIMUM_LIQUIDITY),
            0,
            0,
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(WTRXPair, 'Transfer')
          .withArgs(wallet.address, WTRXPair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(WTRXPair, 'Transfer')
          .withArgs(WTRXPair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(WTRX, 'Transfer')
          .withArgs(WTRXPair.address, router.address, TRXAmount.sub(2000))
          .to.emit(WTRXPartner, 'Transfer')
          .withArgs(WTRXPair.address, router.address, WTRXPartnerAmount.sub(500))
          .to.emit(WTRXPartner, 'Transfer')
          .withArgs(router.address, wallet.address, WTRXPartnerAmount.sub(500))
          .to.emit(WTRXPair, 'Sync')
          .withArgs(
            WTRXPairToken0 === WTRXPartner.address ? 500 : 2000,
            WTRXPairToken0 === WTRXPartner.address ? 2000 : 500
          )
          .to.emit(WTRXPair, 'Burn')
          .withArgs(
            router.address,
            WTRXPairToken0 === WTRXPartner.address ? WTRXPartnerAmount.sub(500) : TRXAmount.sub(2000),
            WTRXPairToken0 === WTRXPartner.address ? TRXAmount.sub(2000) : WTRXPartnerAmount.sub(500),
            router.address
          )

        expect(await WTRXPair.balanceOf(wallet.address)).to.eq(0)
        const totalSupplyWTRXPartner = await WTRXPartner.totalSupply()
        const totalSupplyWTRX = await WTRX.totalSupply()
        expect(await WTRXPartner.balanceOf(wallet.address)).to.eq(totalSupplyWTRXPartner.sub(500))
        expect(await WTRX.balanceOf(wallet.address)).to.eq(totalSupplyWTRX.sub(2000))
      })

      it('removeLiquidityWithPermit', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)
        await addLiquidity(token0Amount, token1Amount)

        const expectedLiquidity = expandTo18Decimals(2)

        const nonce = await pair.nonces(wallet.address)
        const digest = await getApprovalDigest(
          pair,
          { owner: wallet.address, spender: router.address, value: expectedLiquidity.sub(MINIMUM_LIQUIDITY) },
          nonce,
          MaxUint256
        )

        const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(wallet.privateKey.slice(2), 'hex'))

        await router.removeLiquidityWithPermit(
          token0.address,
          token1.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY),
          0,
          0,
          wallet.address,
          MaxUint256,
          false,
          v,
          r,
          s,
          overrides
        )
      })

      it('removeLiquidityTRXWithPermit', async () => {
        const WTRXPartnerAmount = expandTo18Decimals(1)
        const TRXAmount = expandTo18Decimals(4)
        await WTRXPartner.transfer(WTRXPair.address, WTRXPartnerAmount)
        await WTRX.deposit({ value: TRXAmount })
        await WTRX.transfer(WTRXPair.address, TRXAmount)
        await WTRXPair.mint(wallet.address, overrides)

        const expectedLiquidity = expandTo18Decimals(2)

        const nonce = await WTRXPair.nonces(wallet.address)
        const digest = await getApprovalDigest(
          WTRXPair,
          { owner: wallet.address, spender: router.address, value: expectedLiquidity.sub(MINIMUM_LIQUIDITY) },
          nonce,
          MaxUint256
        )

        const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(wallet.privateKey.slice(2), 'hex'))

        await router.removeLiquidityTRXWithPermit(
          WTRXPartner.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY),
          0,
          0,
          wallet.address,
          MaxUint256,
          false,
          v,
          r,
          s,
          overrides
        )
      })

      describe('swapExactTokensForTokens', () => {
        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = bigNumberify('1662497915624478906')

        beforeEach(async () => {
          await addLiquidity(token0Amount, token1Amount)
          await token0.approve(router.address, MaxUint256)
        })

        it('happy path', async () => {
          await expect(
            router.swapExactTokensForTokens(
              swapAmount,
              0,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(token0, 'Transfer')
            .withArgs(wallet.address, pair.address, swapAmount)
            .to.emit(token1, 'Transfer')
            .withArgs(pair.address, wallet.address, expectedOutputAmount)
            .to.emit(pair, 'Sync')
            .withArgs(token0Amount.add(swapAmount), token1Amount.sub(expectedOutputAmount))
            .to.emit(pair, 'Swap')
            .withArgs(router.address, swapAmount, 0, 0, expectedOutputAmount, wallet.address)
        })

        it('amounts', async () => {
          await token0.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapExactTokensForTokens(
              router.address,
              swapAmount,
              0,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([swapAmount, expectedOutputAmount])
        })

        it('gas', async () => {
          // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          await pair.sync(overrides)

          await token0.approve(router.address, MaxUint256)
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          const tx = await router.swapExactTokensForTokens(
            swapAmount,
            0,
            [token0.address, token1.address],
            wallet.address,
            MaxUint256,
            overrides
          )
          const receipt = await tx.wait()
          /*
          expect(receipt.gasUsed).to.eq(
            {
              [RouterVersion.UniswapV2Router01]: 101876,
              [RouterVersion.UniswapV2Router02]: 101898
            }[routerVersion as RouterVersion]
          )
          */
        }).retries(3)
      })

      describe('swapTokensForExactTokens', () => {
        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        const expectedSwapAmount = bigNumberify('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        beforeEach(async () => {
          await addLiquidity(token0Amount, token1Amount)
        })

        it('happy path', async () => {
          await token0.approve(router.address, MaxUint256)
          await expect(
            router.swapTokensForExactTokens(
              outputAmount,
              MaxUint256,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(token0, 'Transfer')
            .withArgs(wallet.address, pair.address, expectedSwapAmount)
            .to.emit(token1, 'Transfer')
            .withArgs(pair.address, wallet.address, outputAmount)
            .to.emit(pair, 'Sync')
            .withArgs(token0Amount.add(expectedSwapAmount), token1Amount.sub(outputAmount))
            .to.emit(pair, 'Swap')
            .withArgs(router.address, expectedSwapAmount, 0, 0, outputAmount, wallet.address)
        })

        it('amounts', async () => {
          await token0.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapTokensForExactTokens(
              router.address,
              outputAmount,
              MaxUint256,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([expectedSwapAmount, outputAmount])
        })
      })

      describe('swapExactTRXForTokens', () => {
        const WTRXPartnerAmount = expandTo18Decimals(10)
        const TRXAmount = expandTo18Decimals(5)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = bigNumberify('1662497915624478906')

        beforeEach(async () => {
          await WTRXPartner.transfer(WTRXPair.address, WTRXPartnerAmount)
          await WTRX.deposit({ value: TRXAmount })
          await WTRX.transfer(WTRXPair.address, TRXAmount)
          await WTRXPair.mint(wallet.address, overrides)

          await token0.approve(router.address, MaxUint256)
        })

        it('happy path', async () => {
          const WTRXPairToken0 = await WTRXPair.token0()
          await expect(
            router.swapExactTRXForTokens(0, [WTRX.address, WTRXPartner.address], wallet.address, MaxUint256, {
              ...overrides,
              value: swapAmount
            })
          )
            .to.emit(WTRX, 'Transfer')
            .withArgs(router.address, WTRXPair.address, swapAmount)
            .to.emit(WTRXPartner, 'Transfer')
            .withArgs(WTRXPair.address, wallet.address, expectedOutputAmount)
            .to.emit(WTRXPair, 'Sync')
            .withArgs(
              WTRXPairToken0 === WTRXPartner.address
                ? WTRXPartnerAmount.sub(expectedOutputAmount)
                : TRXAmount.add(swapAmount),
              WTRXPairToken0 === WTRXPartner.address
                ? TRXAmount.add(swapAmount)
                : WTRXPartnerAmount.sub(expectedOutputAmount)
            )
            .to.emit(WTRXPair, 'Swap')
            .withArgs(
              router.address,
              WTRXPairToken0 === WTRXPartner.address ? 0 : swapAmount,
              WTRXPairToken0 === WTRXPartner.address ? swapAmount : 0,
              WTRXPairToken0 === WTRXPartner.address ? expectedOutputAmount : 0,
              WTRXPairToken0 === WTRXPartner.address ? 0 : expectedOutputAmount,
              wallet.address
            )
        })

        it('amounts', async () => {
          await expect(
            routerEventEmitter.swapExactTRXForTokens(
              router.address,
              0,
              [WTRX.address, WTRXPartner.address],
              wallet.address,
              MaxUint256,
              {
                ...overrides,
                value: swapAmount
              }
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([swapAmount, expectedOutputAmount])
        })

        it('gas', async () => {
          const WTRXPartnerAmount = expandTo18Decimals(10)
          const TRXAmount = expandTo18Decimals(5)
          await WTRXPartner.transfer(WTRXPair.address, WTRXPartnerAmount)
          await WTRX.deposit({ value: TRXAmount })
          await WTRX.transfer(WTRXPair.address, TRXAmount)
          await WTRXPair.mint(wallet.address, overrides)

          // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          await pair.sync(overrides)

          const swapAmount = expandTo18Decimals(1)
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          const tx = await router.swapExactTRXForTokens(
            0,
            [WTRX.address, WTRXPartner.address],
            wallet.address,
            MaxUint256,
            {
              ...overrides,
              value: swapAmount
            }
          )
          const receipt = await tx.wait()
          /*
          expect(receipt.gasUsed).to.eq(
            {
              [RouterVersion.UniswapV2Router01]: 138770,
              [RouterVersion.UniswapV2Router02]: 138770
            }[routerVersion as RouterVersion]
          )
          */
        }).retries(3)
      })

      describe('swapTokensForExactTRX', () => {
        const WTRXPartnerAmount = expandTo18Decimals(5)
        const TRXAmount = expandTo18Decimals(10)
        const expectedSwapAmount = bigNumberify('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        beforeEach(async () => {
          await WTRXPartner.transfer(WTRXPair.address, WTRXPartnerAmount)
          await WTRX.deposit({ value: TRXAmount })
          await WTRX.transfer(WTRXPair.address, TRXAmount)
          await WTRXPair.mint(wallet.address, overrides)
        })

        it('happy path', async () => {
          await WTRXPartner.approve(router.address, MaxUint256)
          const WTRXPairToken0 = await WTRXPair.token0()
          await expect(
            router.swapTokensForExactTRX(
              outputAmount,
              MaxUint256,
              [WTRXPartner.address, WTRX.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(WTRXPartner, 'Transfer')
            .withArgs(wallet.address, WTRXPair.address, expectedSwapAmount)
            .to.emit(WTRX, 'Transfer')
            .withArgs(WTRXPair.address, router.address, outputAmount)
            .to.emit(WTRXPair, 'Sync')
            .withArgs(
              WTRXPairToken0 === WTRXPartner.address
                ? WTRXPartnerAmount.add(expectedSwapAmount)
                : TRXAmount.sub(outputAmount),
              WTRXPairToken0 === WTRXPartner.address
                ? TRXAmount.sub(outputAmount)
                : WTRXPartnerAmount.add(expectedSwapAmount)
            )
            .to.emit(WTRXPair, 'Swap')
            .withArgs(
              router.address,
              WTRXPairToken0 === WTRXPartner.address ? expectedSwapAmount : 0,
              WTRXPairToken0 === WTRXPartner.address ? 0 : expectedSwapAmount,
              WTRXPairToken0 === WTRXPartner.address ? 0 : outputAmount,
              WTRXPairToken0 === WTRXPartner.address ? outputAmount : 0,
              router.address
            )
        })

        it('amounts', async () => {
          await WTRXPartner.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapTokensForExactTRX(
              router.address,
              outputAmount,
              MaxUint256,
              [WTRXPartner.address, WTRX.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([expectedSwapAmount, outputAmount])
        })
      })

      describe('swapExactTokensForTRX', () => {
        const WTRXPartnerAmount = expandTo18Decimals(5)
        const TRXAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = bigNumberify('1662497915624478906')

        beforeEach(async () => {
          await WTRXPartner.transfer(WTRXPair.address, WTRXPartnerAmount)
          await WTRX.deposit({ value: TRXAmount })
          await WTRX.transfer(WTRXPair.address, TRXAmount)
          await WTRXPair.mint(wallet.address, overrides)
        })

        it('happy path', async () => {
          await WTRXPartner.approve(router.address, MaxUint256)
          const WTRXPairToken0 = await WTRXPair.token0()
          await expect(
            router.swapExactTokensForTRX(
              swapAmount,
              0,
              [WTRXPartner.address, WTRX.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(WTRXPartner, 'Transfer')
            .withArgs(wallet.address, WTRXPair.address, swapAmount)
            .to.emit(WTRX, 'Transfer')
            .withArgs(WTRXPair.address, router.address, expectedOutputAmount)
            .to.emit(WTRXPair, 'Sync')
            .withArgs(
              WTRXPairToken0 === WTRXPartner.address
                ? WTRXPartnerAmount.add(swapAmount)
                : TRXAmount.sub(expectedOutputAmount),
              WTRXPairToken0 === WTRXPartner.address
                ? TRXAmount.sub(expectedOutputAmount)
                : WTRXPartnerAmount.add(swapAmount)
            )
            .to.emit(WTRXPair, 'Swap')
            .withArgs(
              router.address,
              WTRXPairToken0 === WTRXPartner.address ? swapAmount : 0,
              WTRXPairToken0 === WTRXPartner.address ? 0 : swapAmount,
              WTRXPairToken0 === WTRXPartner.address ? 0 : expectedOutputAmount,
              WTRXPairToken0 === WTRXPartner.address ? expectedOutputAmount : 0,
              router.address
            )
        })

        it('amounts', async () => {
          await WTRXPartner.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapExactTokensForTRX(
              router.address,
              swapAmount,
              0,
              [WTRXPartner.address, WTRX.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([swapAmount, expectedOutputAmount])
        })
      })

      describe('swapTRXForExactTokens', () => {
        const WTRXPartnerAmount = expandTo18Decimals(10)
        const TRXAmount = expandTo18Decimals(5)
        const expectedSwapAmount = bigNumberify('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        beforeEach(async () => {
          await WTRXPartner.transfer(WTRXPair.address, WTRXPartnerAmount)
          await WTRX.deposit({ value: TRXAmount })
          await WTRX.transfer(WTRXPair.address, TRXAmount)
          await WTRXPair.mint(wallet.address, overrides)
        })

        it('happy path', async () => {
          const WTRXPairToken0 = await WTRXPair.token0()
          await expect(
            router.swapTRXForExactTokens(
              outputAmount,
              [WTRX.address, WTRXPartner.address],
              wallet.address,
              MaxUint256,
              {
                ...overrides,
                value: expectedSwapAmount
              }
            )
          )
            .to.emit(WTRX, 'Transfer')
            .withArgs(router.address, WTRXPair.address, expectedSwapAmount)
            .to.emit(WTRXPartner, 'Transfer')
            .withArgs(WTRXPair.address, wallet.address, outputAmount)
            .to.emit(WTRXPair, 'Sync')
            .withArgs(
              WTRXPairToken0 === WTRXPartner.address
                ? WTRXPartnerAmount.sub(outputAmount)
                : TRXAmount.add(expectedSwapAmount),
              WTRXPairToken0 === WTRXPartner.address
                ? TRXAmount.add(expectedSwapAmount)
                : WTRXPartnerAmount.sub(outputAmount)
            )
            .to.emit(WTRXPair, 'Swap')
            .withArgs(
              router.address,
              WTRXPairToken0 === WTRXPartner.address ? 0 : expectedSwapAmount,
              WTRXPairToken0 === WTRXPartner.address ? expectedSwapAmount : 0,
              WTRXPairToken0 === WTRXPartner.address ? outputAmount : 0,
              WTRXPairToken0 === WTRXPartner.address ? 0 : outputAmount,
              wallet.address
            )
        })

        it('amounts', async () => {
          await expect(
            routerEventEmitter.swapTRXForExactTokens(
              router.address,
              outputAmount,
              [WTRX.address, WTRXPartner.address],
              wallet.address,
              MaxUint256,
              {
                ...overrides,
                value: expectedSwapAmount
              }
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([expectedSwapAmount, outputAmount])
        })
      })
    })
  }
})
