import {
    networks,
    script,
    opcodes,
    payments,
    crypto,
    Psbt
} from "bitcoinjs-lib";
import { broadcast, waitUntilUTXO } from "./blockstream_utils";
import { witnessStackToScriptWitness } from "./witness_stack_to_script_witness";
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

console.log(`Running "Pay to Addition Script example"`);

const network = networks.testnet;
const SECRET = "secret";

const keypair = ECPair.makeRandom({ network });

const preimage = Buffer.from(SECRET);
const hash = crypto.hash160(preimage);
const publicKey = keypair.publicKey;
const recipAddr = crypto.hash160(publicKey);
const locking_script = script.compile([
    opcodes.OP_HASH160,
    hash,
    opcodes.OP_EQUALVERIFY,
    opcodes.OP_DUP,
    opcodes.OP_HASH160,
    recipAddr,
    opcodes.OP_EQUALVERIFY,
    opcodes.OP_CHECKSIG,
]);

const p2wsh = payments.p2wsh({ redeem: { output: locking_script, network }, network });
const p2wshAddr = p2wsh.address ?? "";
console.log(`Address: ${p2wshAddr}`);

waitUntilUTXO(p2wshAddr)
    .then(async (data) => {
        console.log(`Using UTXO ${data[0].txid}:${data[0].vout}`);

        const psbt = new Psbt({ network });
        psbt.addInput({
            hash: data[0].txid,
            index: data[0].vout,
            witnessUtxo: {
                script: p2wsh.output!,
                value: data[0].value // in Satoshis
            },
            witnessScript: locking_script
        });

        psbt.addOutput({
            address: "mohjSavDdQYHRYXcS3uS6ttaHP8amyvX78", // faucet address
            value: data[0].value - 200
        });

        psbt.signInput(0, keypair);

        const finalizeInput = (_inputIndex: number, input: any) => {
            const redeemPayment = payments.p2wsh({
                redeem: {
                    input: script.compile([
                        input.partialSig[0].signature,
                        publicKey,
                        preimage
                    ]),
                    output: input.witnessScript
                }
            });

            const finalScriptWitness = witnessStackToScriptWitness(
                redeemPayment.witness ?? []
            );

            return {
                finalScriptSig: Buffer.from(""),
                finalScriptWitness
            }
        }

        psbt.finalizeInput(0, finalizeInput);

        const tx = psbt.extractTransaction();
        console.log(`Broadcasting Transaction Hex: ${tx.toHex()}`);
        const txid = await broadcast(tx.toHex());
        console.log(`Success! Txid is ${txid}`);
    });

console.log(`Waiting for payment to address: ${p2wshAddr}`);
